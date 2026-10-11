import { getVerifiedSessionToken } from "@/lib/auth";
import { withPgClient } from "@/lib/serverPg";
import { authorizeFinancialStepUp } from "./stepUp";
import { hashTransactionPin, validTransactionPin } from "./transactionPinCrypto";
import { assertTransactionPinApplicable, checkPin, pinErrorResponse, pinTransaction, requiresTransactionPin, TRANSACTION_PIN_COOLING_OFF_MS } from "./transactionPin";

export async function transactionPinStatus(request: Request) {
    try {
        const session=await getVerifiedSessionToken(request.headers);
        if(!session) return Response.json({error:"Unauthorized"},{status:401});
        const required = await requiresTransactionPin(session.wallet);
        if (!required) return Response.json({required:false,configured:false,lockedUntil:null,coolingOffUntil:null},{headers:{'cache-control':'no-store'}});
        const row=await withPgClient(async client=>(await client.query("select locked_until,cooling_off_until from transaction_pin_credentials where wallet_address=$1",[session.wallet.toLowerCase()])).rows[0]);
        return Response.json({required:true,configured:Boolean(row),lockedUntil:row?.locked_until??null,coolingOffUntil:row?.cooling_off_until??null},{headers:{'cache-control':'no-store'}});
    }catch(error){return pinErrorResponse(error);}
}
export async function manageTransactionPin(request: Request, action: 'enroll'|'change'|'reset') {
    try {
        const session=await getVerifiedSessionToken(request.headers);
        if(!session) return Response.json({error:"Unauthorized"},{status:401});
        await assertTransactionPinApplicable(session.wallet);
        const body=await request.json().catch(()=>null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({error:"Invalid JSON payload"},{status:400});
        if(!validTransactionPin(body.pin)) return Response.json({error:"Choose a six-digit PIN without a repeated or sequential pattern."},{status:400});
        const proof=await authorizeFinancialStepUp({headers:request.headers,wallet:session.wallet,session,binding:{action:`transaction-pin:${action}`},allowRecentAuth:false});
        if(!proof.ok) return Response.json({error:proof.error,code:"FRESH_VERIFICATION_REQUIRED"},{status:proof.status});
        const credential=await hashTransactionPin(body.pin);
        const wallet=session.wallet.toLowerCase();
        const coolingOffUntil=action==='reset' ? new Date(Date.now()+TRANSACTION_PIN_COOLING_OFF_MS) : null;
        const result=await pinTransaction(wallet,async client=>{
            const existing=(await client.query("select version,cooling_off_until from transaction_pin_credentials where wallet_address=$1 for update",[wallet])).rows[0];
            if(action==='enroll' && existing) return {error:"A PIN is already configured.",status:409};
            if(action!=='enroll' && !existing) return {error:"Enroll a transaction PIN first.",status:409};
            if(action==='change') {
                const check=await checkPin(client,wallet,body.currentPin);
                // Return rather than throw: wrong-PIN counters must commit.
                if(!check.ok) return {error:"Current PIN verification failed.",code:check.code,status:check.status};
            }
            await client.query(`insert into transaction_pin_credentials(wallet_address,salt,pin_hash,cooling_off_until)
                values($1,$2,$3,$4) on conflict(wallet_address) do update set salt=excluded.salt,pin_hash=excluded.pin_hash,
                version=transaction_pin_credentials.version+1,failed_attempts=0,locked_until=null,cooling_off_until=greatest(transaction_pin_credentials.cooling_off_until,excluded.cooling_off_until),updated_at=now()`,[wallet,credential.salt,credential.hash,coolingOffUntil]);
            // Preserve stricter existing holds, including indefinite admin holds.
            if (coolingOffUntil) await client.query(`insert into withdrawal_holds(address,scope,reason,placed_by,expires_at)
                values($1,'BOTH','Transaction PIN security cooling-off','transaction-pin-security',$2)
                on conflict(address) do update set scope='BOTH',expires_at=case when withdrawal_holds.expires_at is null then null
                else greatest(withdrawal_holds.expires_at,excluded.expires_at) end,updated_at=now()`,[wallet,coolingOffUntil]);
            await client.query("insert into transaction_pin_security_events(wallet_address,event_kind,cooling_off_until) values($1,$2,$3)",[wallet,action,coolingOffUntil]);
            // Previously issued PIN authorizations die on version change. Running operations remain immutable.
            await client.query("update transaction_pin_operations set state='challenge',token_hash=null where wallet_address=$1 and state='authorized'",[wallet]);
            return {success:true,coolingOffUntil:coolingOffUntil ?? existing?.cooling_off_until ?? null};
        });
        if('error' in result) return Response.json({error:result.error,code:result.code},{status:result.status});
        return Response.json({success:true,configured:true,coolingOffUntil:result.coolingOffUntil ? new Date(result.coolingOffUntil).toISOString() : null},{headers:{'cache-control':'no-store'}});
    }catch(error){return pinErrorResponse(error);}
}
