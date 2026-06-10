import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import { KafkaEvent, Topics } from "./events";
import { addressToBuffer } from "../payments/address";
import { ProtocolConfig } from "../payments/config";

/* Define runtime client structure for Kafka */
let KafkaClient: any = null;
try {
    /* Dynamic import to ensure compile success without hard dependency */
    KafkaClient = require("kafkajs").Kafka;
} catch {
    /* Fallback mode when kafkajs is not locally installed */
}

export class EventSourcedEngine {
    private supabase: any;
    private rpcProvider: ethers.JsonRpcProvider;
    private wsProvider: ethers.WebSocketProvider | null = null;
    private isRunning = false;

    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        this.supabase = createClient(supabaseUrl, supabaseServiceKey);
        this.rpcProvider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://rpc.testnet.arc.network");
        this.initWebSocket();
    }

    private initWebSocket() {
        const wsUrl = process.env.WS_RPC_URL || "wss://ws.testnet.arc.network";
        try {
            this.wsProvider = new ethers.WebSocketProvider(wsUrl);
            this.wsProvider.on("error", (err) => {
                console.error("[ChainWorker] WSS Error, falling back to polling:", err);
                this.wsProvider = null;
            });
        } catch {
            this.wsProvider = null;
        }
    }

    public async start() {
        this.isRunning = true;
        await Promise.all([
            this.startChainWorker(),
            this.startProjectionWorker(),
            this.startPayoutWorker()
        ]);
    }

    public async stop() {
        this.isRunning = false;
        if (this.wsProvider) {
            await this.wsProvider.destroy();
        }
    }

    /* ─────────────────────────── 1. CHAIN WORKER ─────────────────────────── */
    private async startChainWorker() {
        console.log("[ChainWorker] Initializing chain listener...");
        
        const processBlock = async (blockNumber: number) => {
            try {
                const block = await this.rpcProvider.getBlock(blockNumber, true);
                if (!block) return;

                /* Loop through transactions in the block */
                for (const txHash of block.transactions) {
                    const receipt = await this.rpcProvider.getTransactionReceipt(txHash);
                    if (!receipt) continue;

                    /* Check if target contract matches USDC or Router */
                    if (
                        receipt.to &&
                        (receipt.to.toLowerCase() === ProtocolConfig.USDC_ADDRESS.toLowerCase() ||
                         receipt.to.toLowerCase() === ProtocolConfig.ROUTER_ADDRESS.toLowerCase())
                    ) {
                        const status = receipt.status === 1 ? "TX_CONFIRMED" : "TX_FAILED";
                        
                        /* Push block verification event to event log */
                        await this.publishEvent(Topics.PAYMENT, {
                            eventId: crypto.randomUUID(),
                            entityId: txHash.toLowerCase(),
                            entityType: "PAYMENT",
                            eventType: status,
                            correlationId: txHash.toLowerCase(),
                            sequenceNumber: Number(receipt.blockNumber),
                            payload: {
                                txHash: txHash.toLowerCase(),
                                blockNumber: receipt.blockNumber,
                                confirmations: 1
                            },
                            createdAt: new Date().toISOString()
                        });
                    }
                }
            } catch (err) {
                console.error("[ChainWorker] Block processing error:", err);
            }
        };

        /* Listen for events via WSS with HTTP fallback */
        if (this.wsProvider) {
            this.wsProvider.on("block", async (blockNumber) => {
                await processBlock(blockNumber);
            });
        } else {
            /* Fallback polling loop */
            let lastBlock = await this.rpcProvider.getBlockNumber();
            (async () => {
                while (this.isRunning) {
                    try {
                        const currentBlock = await this.rpcProvider.getBlockNumber();
                        if (currentBlock > lastBlock) {
                            for (let b = lastBlock + 1; b <= currentBlock; b++) {
                                await processBlock(b);
                            }
                            lastBlock = currentBlock;
                        }
                    } catch (err) {
                        console.error("[ChainWorker] Polling error:", err);
                    }
                    await new Promise(res => setTimeout(res, 4000));
                }
            })();
        }
    }

    /* ─────────────────────────── 2. PROJECTION WORKER ─────────────────────────── */
    private async startProjectionWorker() {
        console.log("[ProjectionWorker] Listening to event stream...");
        
        /* Simulates Kafka consumer loop consuming partition messages sequentially */
        (async () => {
            while (this.isRunning) {
                try {
                    /* Read unprocessed event logs from DB acting as Kafka partition commit offsets */
                    const { data: events, error } = await this.supabase
                        .from("event_log")
                        .select("*")
                        .order("sequence_number", { ascending: true })
                        .limit(50);

                    if (error) throw error;

                    if (events && events.length > 0) {
                        for (const event of events) {
                            await this.projectEvent(event as KafkaEvent);
                            
                            /* Delete processed event from queue */
                            await this.supabase.from("event_log").delete().eq("id", event.id);
                        }
                    }
                } catch (err) {
                    console.error("[ProjectionWorker] Processing error:", err);
                }
                await new Promise(res => setTimeout(res, 2000));
            }
        })();
    }

    private async projectEvent(event: KafkaEvent) {
        /* Enforce Idempotency */
        const { data: latestEntry } = await this.supabase
            .from("ledger_entries")
            .select("id, created_at")
            .eq("reference_id", event.entityId)
            .maybeSingle();

        if (latestEntry) {
            /* Event already projected, discard duplicate */
            return;
        }

        /* Update transaction states & ledger records based on event type */
        if (event.entityType === "PAYMENT") {
            const status = event.eventType === "TX_CONFIRMED" ? "CONFIRMED" : "FAILED";
            
            await this.supabase
                .from("transaction_verifications")
                .update({
                    status,
                    confirmations: event.payload.confirmations,
                    updated_at: new Date().toISOString()
                })
                .eq("tx_hash", event.entityId);

            /* Transition ledger entry status from PENDING to FINALIZED or FAILED */
            const ledgerStatus = event.eventType === "TX_CONFIRMED" ? "FINALIZED" : "FAILED";
            await this.supabase
                .from("ledger_entries")
                .update({
                    status: ledgerStatus
                })
                .eq("tx_hash", event.entityId);
        }
    }

    /* ─────────────────────────── 3. PAYOUT WORKER ─────────────────────────── */
    private async startPayoutWorker() {
        console.log("[PayoutWorker] Initializing batch distribution listener...");
        
        /* Monitors batch payout requests and processes them */
        (async () => {
            while (this.isRunning) {
                try {
                    const { data: pendingBatches } = await this.supabase
                        .from("payout_batches")
                        .select("*")
                        .eq("status", "PENDING")
                        .limit(10);

                    if (pendingBatches) {
                        for (const batch of pendingBatches) {
                            await this.processBatchPayout(batch);
                        }
                    }
                } catch (err) {
                    console.error("[PayoutWorker] Batch loop error:", err);
                }
                await new Promise(res => setTimeout(res, 5000));
            }
        })();
    }

    private async processBatchPayout(batch: any) {
        const merchantAddr = batch.merchant_address.toLowerCase();

        /* Lock merchant row for balance verification */
        await this.supabase.rpc("lock_merchant_row", {
            p_wallet_address: merchantAddr
        });

        /* Read from the Spendable Balance derived view */
        const { data: balanceData } = await this.supabase
            .from("merchant_spendable_balances")
            .select("spendable_balance")
            .eq("wallet_address", merchantAddr)
            .single();

        const spendable = BigInt(balanceData?.spendable_balance || "0");
        const batchTotal = BigInt(batch.total_amount_usdc);

        if (spendable < batchTotal) {
            /* Fail the batch if spendable balance is insufficient */
            await this.supabase
                .from("payout_batches")
                .update({ status: "FAILED", updated_at: new Date().toISOString() })
                .eq("id", batch.id);
            return;
        }

        /* Emit PAYOUT_RESERVED event to event log first */
        await this.publishEvent(Topics.PAYOUT, {
            eventId: crypto.randomUUID(),
            entityId: batch.id,
            entityType: "PAYOUT",
            eventType: "PAYOUT_RESERVED",
            correlationId: batch.id,
            sequenceNumber: Date.now(),
            payload: {
                batchId: batch.id,
                amount: batchTotal.toString(),
                merchant: merchantAddr
            },
            createdAt: new Date().toISOString()
        });

        /* Update batch state in db to PROCESSING */
        await this.supabase
            .from("payout_batches")
            .update({ status: "PROCESSING", updated_at: new Date().toISOString() })
            .eq("id", batch.id);

        /* Write debit ledger entry in PENDING state to reserve funds */
        await this.supabase
            .from("ledger_entries")
            .insert({
                merchant_address: addressToBuffer(merchantAddr),
                entry_type: "DEBIT_BATCH_PAYOUT",
                status: "PENDING",
                amount_usdc: batchTotal.toString(),
                reference_type: "BATCH_PAYOUT",
                reference_id: batch.id
            });
    }

    /* ─────────────────────────── PUBLISHER BACKBONE ─────────────────────────── */
    public async publishEvent(topic: string, event: KafkaEvent) {
        if (KafkaClient) {
            /* High-reliability publish using kafkajs client */
            try {
                const kafka = new KafkaClient({
                    clientId: "subscript-producer",
                    brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(",")
                });
                const producer = kafka.producer();
                await producer.connect();
                await producer.send({
                    topic,
                    messages: [
                        {
                            key: event.entityId,
                            value: JSON.stringify(event)
                        }
                    ]
                });
                await producer.disconnect();
            } catch (err) {
                console.warn("[Producer] Failed publishing to Kafka broker. Storing to local postgres event log:", err);
                await this.storeEventLocally(event);
            }
        } else {
            /* Fallback to PostgreSQL event log */
            await this.storeEventLocally(event);
        }
    }

    private async storeEventLocally(event: KafkaEvent) {
        await this.supabase
            .from("event_log")
            .insert({
                event_id: event.eventId,
                entity_id: event.entityId,
                entity_type: event.entityType,
                event_type: event.eventType,
                correlation_id: event.correlationId,
                sequence_number: event.sequenceNumber,
                payload: event.payload,
                created_at: event.createdAt
            });
    }
}
