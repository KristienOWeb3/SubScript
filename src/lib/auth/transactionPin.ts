import crypto from "node:crypto";
import { runFinancialAuthorization } from "./financialAuthorizationContext";
import { getVerifiedSessionToken, type VerifiedSessionToken } from "@/lib/auth";
import { withPgClient } from "@/lib/serverPg";
import { authorizationDigest, verifyTransactionPinHash } from "./transactionPinCrypto";
import { transactionPinRequiredForWallet } from "./transactionPinEligibility";

const authorizedRequests = new WeakSet<Request>();
export function isTransactionPinAuthorizedRequest(request: Request) { return authorizedRequests.has(request); }

export const TRANSACTION_PIN_COOLING_OFF_MS = 24 * 60 * 60 * 1000;
type Client = { query: (sql: string, values?: unknown[]) => Promise<{rows: any[]; rowCount?: number}> };
export class TransactionPinError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
}
export const requiresTransactionPin = transactionPinRequiredForWallet;
/** Atomic limit writers still require PIN approval for custody accounts. */
export async function isTransactionLimitIncreaseAuthorized(request: Request, wallet: string): Promise<boolean> {
    return isTransactionPinAuthorizedRequest(request) || !await requiresTransactionPin(wallet);
}
export async function assertTransactionPinApplicable(wallet: string): Promise<void> {
    if (!await requiresTransactionPin(wallet)) {
        throw new TransactionPinError(409, "TRANSACTION_PIN_NOT_APPLICABLE", "External wallets authorize transactions in their connected wallet and do not use a transaction PIN.");
    }
}
export function pinErrorResponse(error: unknown) {
    if (error instanceof TransactionPinError) return Response.json({error: error.message, code: error.code}, {status:error.status});
    // Never serialize request bodies, credentials, tokens or driver errors.
    return Response.json({error:"Transaction authorization is temporarily unavailable.",code:"TRANSACTION_PIN_UNAVAILABLE"},{status:503});
}
export async function pinTransaction<T>(wallet: string, callback: (client: Client) => Promise<T>): Promise<T> {
    return withPgClient(async client => {
        await client.query("BEGIN");
        try {
            await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`transaction-pin:${wallet}`]);
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        } catch (error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
    });
}
export async function checkPin(client: Client, wallet: string, pin: unknown) {
    const credential = (await client.query("select * from transaction_pin_credentials where wallet_address=$1 for update", [wallet])).rows[0];
    if (!credential) return {ok:false,code:"TRANSACTION_PIN_NOT_CONFIGURED",status:428,credential:null};
    if (credential.locked_until && new Date(credential.locked_until).getTime()>Date.now()) return {ok:false,code:"TRANSACTION_PIN_LOCKED",status:429,credential};
    if (!await verifyTransactionPinHash(pin, credential.salt, credential.pin_hash)) {
        const attempts=Number(credential.failed_attempts)+1;
        // Consecutive failures survive process restart. At five, lock for 24 hours.
        const seconds=attempts>=5 ? 24*60*60 : Math.min(300, 2 ** attempts);
        await client.query("update transaction_pin_credentials set failed_attempts=$2,locked_until=now()+($3::integer * interval '1 second') where wallet_address=$1",[wallet,attempts,seconds]);
        return {ok:false,code:"TRANSACTION_PIN_INVALID",status:403,credential};
    }
    await client.query("update transaction_pin_credentials set failed_attempts=0,locked_until=null where wallet_address=$1",[wallet]);
    return {ok:true,code:"",status:200,credential};
}
export type TransactionPinOptions = {
    action: string;
    required?: (body: any, session: VerifiedSessionToken, request: Request) => boolean | Promise<boolean>;
    bind?: (body: any, session: VerifiedSessionToken, request: Request, context: TransactionPinBindingContext) => unknown | Promise<unknown>;
};
export type TransactionPinBindingContext = { quotedAt: Date };
export function withTransactionPin<C>(options: TransactionPinOptions, handler: (request: Request, context: C) => Promise<Response>) {
    return async (request: Request, context: C): Promise<Response> => {
        let operation: any;
        let wallet: string | undefined;
        try {
            const session=await getVerifiedSessionToken(request.headers);
            if (!session) return Response.json({error:"Unauthorized"},{status:401});
            wallet=session.wallet.toLowerCase();
            let body: unknown = null;
            const raw=await request.clone().text();
            if (raw) { try {body=JSON.parse(raw);} catch {return Response.json({error:"Invalid JSON payload"},{status:400});} }
            if (!await requiresTransactionPin(wallet)) {
                if (!options.bind) return await handler(request,context);
                const bindingContext = { quotedAt: new Date() };
                const authority = await options.bind(body,session,request,bindingContext);
                // External actors use standing authority without PINs; mutable terms must
                // still be checked at custody boundaries, including delegated parent funds.
                return await runFinancialAuthorization(authority, async () => options.bind!(body,session,request,bindingContext), () => handler(request,context));
            }
            const operationId=request.headers.get("x-transaction-operation-id");
            const sessionDigest=authorizationDigest(session.token);
            const url=new URL(request.url);
            const requestDigest=authorizationDigest({action:options.action,method:request.method,path:url.pathname,query:url.search,wallet,session:sessionDigest,operationId,body});
            // Terminal results depend on the immutable request, not current authority state.
            // Rotation/cap edits naturally change live authority after a successful operation.
            const previous=operationId ? await withPgClient<any>(async client=>(await client.query("select * from transaction_pin_operations where wallet_address=$1 and operation_id=$2",[wallet,operationId])).rows[0]) : null;
            if(previous) {
                if(previous.request_digest!==requestDigest || previous.session_digest!==sessionDigest) throw new TransactionPinError(409,"TRANSACTION_OPERATION_MISMATCH","This operation is bound to a different request.");
                if(previous.state==='complete') return new Response([204,205,304].includes(previous.response_status) ? null : previous.response_body,{status:previous.response_status,headers:{"content-type":previous.response_content_type||"application/json","x-transaction-operation-id":operationId!}});
                if(previous.state==='running'||previous.state==='unknown') return Response.json({code:"TRANSACTION_OPERATION_IN_PROGRESS",operationId,error:"This operation may already be submitted. Check its transaction status before creating another operation."},{status:409});
            }
            if (options.required && !await options.required(body,session,request)) {
                if(previous) throw new TransactionPinError(409,"TRANSACTION_OPERATION_MISMATCH","Use a new operation ID after an authority change.");
                return handler(request,context);
            }
            if (!operationId || !/^[a-zA-Z0-9:_-]{1,160}$/.test(operationId)) return Response.json({error:"A stable transaction operation ID is required.",code:"TRANSACTION_OPERATION_ID_REQUIRED"},{status:400});
            // Persist the server quote time with the challenge; retries and custody checks reuse it.
            const bindingContext = { quotedAt: previous ? new Date(previous.created_at) : new Date() };
            const authority=options.bind ? await options.bind(body,session,request,bindingContext) : null;
            const bindingDigest=authorizationDigest({requestDigest,authority});
            const token=request.headers.get("x-transaction-pin-token");
            const result=await pinTransaction(wallet,async client=> {
                const credential=(await client.query("select version,cooling_off_until from transaction_pin_credentials where wallet_address=$1",[wallet])).rows[0];
                await client.query(`insert into transaction_pin_operations(wallet_address,operation_id,session_digest,binding_digest,request_digest,created_at)
                    values($1,$2,$3,$4,$5,$6) on conflict(wallet_address,operation_id) do nothing`,[wallet,operationId,sessionDigest,bindingDigest,requestDigest,bindingContext.quotedAt]);
                const row=(await client.query("select * from transaction_pin_operations where wallet_address=$1 and operation_id=$2 for update",[wallet,operationId])).rows[0];
                if(row.request_digest!==requestDigest || row.session_digest!==sessionDigest) throw new TransactionPinError(409,"TRANSACTION_OPERATION_MISMATCH","This operation is bound to a different request.");
                if(row.state==='complete') return {kind:'cached',row};
                if(row.state==='running'||row.state==='unknown') return {kind:'running',row};
                if(row.binding_digest!==bindingDigest) throw new TransactionPinError(409,"TRANSACTION_AUTHORITY_CHANGED","Authority changed after this challenge. Start a new operation.");
                if(credential?.cooling_off_until && new Date(credential.cooling_off_until).getTime()>Date.now()) throw new TransactionPinError(403,"TRANSACTION_PIN_COOLING_OFF","Transactions are on hold for 24 hours after PIN recovery.");
                if(!token) {
                    // Expired challenges may be refreshed only before execution.
                    if(new Date(row.expires_at).getTime()<=Date.now()) await client.query("update transaction_pin_operations set state='challenge',token_hash=null,expires_at=now()+interval '5 minutes' where challenge_id=$1",[row.challenge_id]);
                    return {kind:'challenge',row,configured:Boolean(credential)};
                }
                if(!credential || row.credential_version!==credential.version || row.state!=='authorized' || new Date(row.expires_at).getTime()<=Date.now() || row.token_hash!==authorizationDigest(token)) throw new TransactionPinError(403,"TRANSACTION_PIN_AUTHORIZATION_INVALID","PIN authorization is expired or does not match this operation.");
                await client.query("update transaction_pin_operations set state='running',token_hash=null,updated_at=now() where challenge_id=$1",[row.challenge_id]);
                return {kind:'execute',row};
            });
            if(result.kind==='cached') return new Response([204,205,304].includes(result.row.response_status) ? null : result.row.response_body,{status:result.row.response_status,headers:{"content-type":result.row.response_content_type||"application/json","x-transaction-operation-id":operationId}});
            if(result.kind==='running') return Response.json({code:"TRANSACTION_OPERATION_IN_PROGRESS",operationId,error:"This operation may already be submitted. Check its transaction status before creating another operation."},{status:409});
            if(result.kind==='challenge') return Response.json({code:"TRANSACTION_PIN_REQUIRED",challengeId:result.row.challenge_id,configured:result.configured,operationId},{status:428});
            operation=result.row;
            authorizedRequests.add(request);
            let response: Response;
            try { response=await runFinancialAuthorization(authority, async () => options.bind ? options.bind(body,session,request,bindingContext) : null, () => handler(request,context)); } finally { authorizedRequests.delete(request); }
            try {
                const responseBody=await response.clone().text();
                if(Buffer.byteLength(responseBody)>256*1024) throw new Error("Response exceeds durable result limit");
                await withPgClient(client=>client.query("update transaction_pin_operations set state='complete',response_status=$2,response_body=$3,response_content_type=$4,updated_at=now() where challenge_id=$1 and state='running'",[operation.challenge_id,response.status,responseBody,response.headers.get('content-type')]));
            } catch {
                // The handler already submitted or completed. Preserve its truthful response;
                // running/unknown remains durable and never grants another signing attempt.
                await withPgClient(client=>client.query("update transaction_pin_operations set state='unknown',updated_at=now() where challenge_id=$1 and state='running'",[operation.challenge_id])).catch(()=>undefined);
            }
            return response;
        } catch(error) {
            if(operation) await withPgClient(client=>client.query("update transaction_pin_operations set state='unknown',updated_at=now() where challenge_id=$1 and state='running'",[operation.challenge_id])).catch(()=>undefined);
            return pinErrorResponse(error);
        }
    };
}
export async function authorizeTransactionPin(request: Request) {
    try {
        const session=await getVerifiedSessionToken(request.headers);
        if(!session) return Response.json({error:"Unauthorized"},{status:401});
        await assertTransactionPinApplicable(session.wallet);
        const body=await request.json().catch(()=>null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({error:"Invalid JSON payload"},{status:400});
        if(typeof body.challengeId!=="string"|| !/^[0-9a-f-]{36}$/i.test(body.challengeId)) return Response.json({error:"Invalid challenge"},{status:400});
        const wallet=session.wallet.toLowerCase();
        const result=await pinTransaction(wallet,async client=>{
            const row=(await client.query("select * from transaction_pin_operations where challenge_id=$1 and wallet_address=$2 for update",[body.challengeId,wallet])).rows[0];
            if(!row || row.session_digest!==authorizationDigest(session.token) || !['challenge','authorized'].includes(row.state) || new Date(row.expires_at).getTime()<=Date.now()) return {error:"TRANSACTION_PIN_CHALLENGE_INVALID",status:403};
            const check=await checkPin(client,wallet,body.pin);
            if(!check.ok) return {error:check.code,status:check.status};
            if(check.credential.cooling_off_until && new Date(check.credential.cooling_off_until).getTime()>Date.now()) return {error:"TRANSACTION_PIN_COOLING_OFF",status:403};
            const token=crypto.randomBytes(32).toString('base64url');
            await client.query("update transaction_pin_operations set state='authorized',token_hash=$2,credential_version=$3,expires_at=now()+interval '5 minutes',updated_at=now() where challenge_id=$1",[body.challengeId,authorizationDigest(token),check.credential.version]);
            return {token};
        });
        if('error' in result) return Response.json({error:"Transaction PIN authorization was refused.",code:result.error},{status:result.status});
        return Response.json({token:result.token,expiresInSeconds:300});
    }catch(error){return pinErrorResponse(error);}
}
