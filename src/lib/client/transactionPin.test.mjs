import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelPendingTransactionPinRequests, ensureTransactionPinSetup, fetchWithTransactionPin, readPinResponse, readTransactionPinStatus } from './transactionPin.ts';

test('PIN response parsing rejects HTML and malformed payloads with a usable error', async () => {
 for (const body of ['<!DOCTYPE html><html></html>', 'null', '[]', '"unexpected"']) {
  await assert.rejects(readPinResponse(new Response(body, {status: 404})), /PIN verification service is unavailable/);
 }
 assert.deepEqual(await readPinResponse(Response.json({error:'Please wait',retryAfterSeconds:60},{status:429})), {error:'Please wait',retryAfterSeconds:60});
 assert.equal((await readPinResponse(Response.json({challengeId:'challenge'}))).challengeId, 'challenge');
});

test('server external wallet exemption permits signing without PIN enrollment',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async input=>{calls.push(input);return isStatusRequest(input)?Response.json({required:false,configured:false}):Response.json({walletApprovalRequired:true});};
 try{
  const response=await fetchWithTransactionPin('/api/user/wallet/send',{method:'POST',body:'{}'},undefined,async()=>assert.fail('external wallet must not prompt for PIN'));
  assert.equal(response.status,200);assert.deepEqual(calls,['/api/user/transaction-pin','/api/user/wallet/send']);
 }finally{globalThis.fetch=original;}
});

test('missing scope flag preserves older server PIN requirement and malformed flags fail closed',async()=>{
 assert.equal((await readTransactionPinStatus(Response.json({configured:false}))).required,true);
 for(const required of [null,'false',0,{},[]])await assert.rejects(readTransactionPinStatus(Response.json({required,configured:false})));
});

const challenge = () => Response.json({ code: 'TRANSACTION_PIN_REQUIRED', challengeId: 'challenge-1', configured: true }, { status: 428 });
const configuredStatus = () => Response.json({ configured: true });
const isStatusRequest = input => input === '/api/user/transaction-pin';

test('retries the identical batch with stable operation id and opaque token, showing all recipients', async () => {
    const original = globalThis.fetch;
    const calls = [];
    const body = JSON.stringify({ recipients: [{ receiverAddress: 'alice', amountUsdc: '2' }, { receiverAddress: 'bob', amountUsdc: '3' }], signature: 'private-signature' });
    globalThis.fetch = async (input, init) => { if (isStatusRequest(input)) return configuredStatus(); calls.push({ input, init }); return calls.length === 1 ? challenge() : Response.json({ success: true }); };
    try {
        const response = await fetchWithTransactionPin('/api/user/wallet/send', { method: 'POST', body, headers: { 'x-request-id': 'send-request' } }, undefined, async (requestChallenge, review) => {
            assert.equal(requestChallenge.operationId, 'send-request');
            assert.deepEqual(review.details.request.recipients, JSON.parse(body).recipients);
            assert.equal(review.details.request.signature, '[hidden]');
            return 'opaque-token';
        });
        assert.equal(response.status, 200);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].init.body, calls[1].init.body);
        assert.equal(calls[0].init.headers.get('x-transaction-operation-id'), 'send-request');
        assert.equal(calls[1].init.headers.get('x-transaction-operation-id'), 'send-request');
        assert.equal(calls[1].init.headers.get('x-transaction-pin-token'), 'opaque-token');
        assert.equal(calls[0].init.headers.get('x-transaction-pin-token'), null);
    } finally { globalThis.fetch = original; }
});

test('cancelled authorization never submits a transaction retry', async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async input => { if (isStatusRequest(input)) return configuredStatus(); calls++; return challenge(); };
    try {
        await assert.rejects(fetchWithTransactionPin('/api/execute-tx', { method: 'POST', body: '{}' }, undefined, async () => { throw new DOMException('Cancelled', 'AbortError'); }), { name: 'AbortError' });
        assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
});

test('aborting while PIN prompt is open prevents replay through the combined abort signal', async () => {
    const original = globalThis.fetch; const controller = new AbortController(); let calls = 0;
    let requestSignal;
    globalThis.fetch = async (input, init) => { if (isStatusRequest(input)) return configuredStatus(); requestSignal = init.signal; assert.equal(init.signal.aborted, false); calls++; return challenge(); };
    try {
        await assert.rejects(fetchWithTransactionPin('/api/user/vault/topup', { method: 'POST', signal: controller.signal }, undefined, async (_challenge, _review, signal) => { assert.equal(signal, requestSignal); controller.abort(); assert.equal(signal.aborted, true); return 'token'; }), { name: 'AbortError' });
        assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
});

for (const phase of ['preflight', 'challenge']) test(`navigation cancels delayed ${phase} without a caller signal or late prompt`, async () => {
    const original = globalThis.fetch; const calls = []; let release; let promptCount = 0;
    const delayed = new Promise(resolve => { release = resolve; });
    let reached;
    const started = new Promise(resolve => { reached = resolve; });
    let cancelledSignal;
    globalThis.fetch = async (input, init) => {
        calls.push(input);
        if ((phase === 'preflight' && isStatusRequest(input)) || (phase === 'challenge' && !isStatusRequest(input))) {
            cancelledSignal = init.signal; reached(); return delayed;
        }
        return configuredStatus();
    };
    try {
        const pending = fetchWithTransactionPin('/api/user/wallet/send', { method: 'POST', body: '{}' }, undefined, async () => { promptCount++; return 'stale-token'; });
        const rejected = assert.rejects(pending, { name: 'AbortError' });
        await started;
        cancelPendingTransactionPinRequests();
        assert.equal(cancelledSignal.aborted, true);
        release(phase === 'preflight' ? configuredStatus() : challenge());
        await rejected;
        assert.equal(promptCount, 0);
        assert.equal(calls.filter(input => !isStatusRequest(input)).length, phase === 'preflight' ? 0 : 1);
        // New work on the destination route gets a fresh cancellation scope.
        globalThis.fetch = async (_, init) => { assert.equal(init.signal.aborted, false); return configuredStatus(); };
        await ensureTransactionPinSetup();
    } finally { globalThis.fetch = original; }
});

test('navigation during a delayed prompt cannot replay even if the prompt returns a token', async () => {
    const original = globalThis.fetch; let mutations = 0; let release; let entered;
    const prompting = new Promise(resolve => { entered = resolve; });
    const delayedToken = new Promise(resolve => { release = resolve; });
    globalThis.fetch = async input => isStatusRequest(input) ? configuredStatus() : (++mutations, challenge());
    try {
        const pending = fetchWithTransactionPin('/api/user/wallet/send', { method: 'POST' }, undefined, async () => { entered(); return delayedToken; });
        const rejected = assert.rejects(pending, { name: 'AbortError' });
        await prompting;
        cancelPendingTransactionPinRequests(); release('late-token');
        await rejected; assert.equal(mutations, 1);
    } finally { globalThis.fetch = original; }
});

test('navigation aborts an authorized replay already in flight', async () => {
    const original = globalThis.fetch; let mutations = 0; let replayStarted;
    const replay = new Promise(resolve => { replayStarted = resolve; });
    globalThis.fetch = async (input, init) => {
        if (isStatusRequest(input)) return configuredStatus();
        if (++mutations === 1) return challenge();
        replayStarted();
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    };
    try {
        const pending = fetchWithTransactionPin('/api/user/wallet/send', { method: 'POST' }, undefined, async () => 'token');
        const rejected = assert.rejects(pending, { name: 'AbortError' });
        await replay; cancelPendingTransactionPinRequests();
        await rejected; assert.equal(mutations, 2);
    } finally { globalThis.fetch = original; }
});

test('pending settlement and exempt reads are returned unchanged without PIN prompt', async () => {
    const original = globalThis.fetch;
    const pending = Response.json({ success: true, pending: true, circleTxId: 'pending-id' }, { status: 202 });
    globalThis.fetch = async input => isStatusRequest(input) ? configuredStatus() : pending;
    try {
        const prompt = async () => { assert.fail('must not prompt'); };
        assert.equal(await fetchWithTransactionPin('/api/user/wallet/send', { method: 'POST' }, undefined, prompt), pending);
        assert.equal(await fetchWithTransactionPin('/api/user/vault/config', {}, undefined, prompt), pending);
    } finally { globalThis.fetch = original; }
});

test('query parameters preserve delegated resource and action in review', async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async input => isStatusRequest(input) ? configuredStatus() : ++calls === 1 ? challenge() : Response.json({ success: true });
    try {
        await fetchWithTransactionPin('/api/user/vault/shares?vaultId=vault-1&commitId=delegate-1&action=rotate', { method: 'PATCH' }, undefined, async (_challenge, review) => {
            assert.deepEqual(review.details.parameters, { vaultId: 'vault-1', commitId: 'delegate-1', action: 'rotate' }); return 'token';
        });
    } finally { globalThis.fetch = original; }
});

test('unconfigured PIN opens setup before any financial mutation even if prompt returns a token', async () => {
    const original = globalThis.fetch; const calls = []; let prompts = 0;
    globalThis.fetch = async (input, init) => {
        calls.push(input); assert.equal(input, '/api/user/transaction-pin');
        assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal);
        return Response.json({ configured: false });
    };
    try {
        await assert.rejects(fetchWithTransactionPin('/api/user/wallet/send', { method: 'POST', body: '{}' }, undefined, async requestChallenge => {
            prompts++; assert.equal(requestChallenge.configured, false); assert.deepEqual(calls, ['/api/user/transaction-pin']); return 'cannot-authorize-setup';
        }), { name: 'AbortError' });
        assert.equal(prompts, 1); assert.deepEqual(calls, ['/api/user/transaction-pin']);
    } finally { globalThis.fetch = original; }
});

test('setup guard cancellation prevents the caller signing or writing', async () => {
    const original = globalThis.fetch; let signed = false; let writes = 0;
    globalThis.fetch = async input => { assert.equal(input, '/api/user/transaction-pin'); return Response.json({ configured: false }); };
    try {
        await assert.rejects((async () => {
            await ensureTransactionPinSetup(undefined, async requestChallenge => { assert.equal(requestChallenge.configured, false); throw new DOMException('Cancelled', 'AbortError'); });
            signed = true; writes++;
        })(), { name: 'AbortError' });
        assert.equal(signed, false); assert.equal(writes, 0);
    } finally { globalThis.fetch = original; }
});

test('configured setup guard permits signing without a setup popup', async () => {
    const original = globalThis.fetch; let signed = false;
    globalThis.fetch = async input => { assert.equal(input, '/api/user/transaction-pin'); return configuredStatus(); };
    try {
        await ensureTransactionPinSetup(undefined, async () => { assert.fail('configured guard must not open setup'); });
        signed = true; assert.equal(signed, true);
    } finally { globalThis.fetch = original; }
});

test('unavailable and malformed PIN status fail before financial mutation or prompt', async () => {
    const original = globalThis.fetch;
    try {
        for (const response of [Response.json({ error: 'Storage unavailable' }, { status: 503 }), Response.json({}), Response.json({ configured: 'true' }), Response.json({ configured: true, lockedUntil: 'invalid-date' })]) {
            const calls = [];
            globalThis.fetch = async input => { calls.push(input); assert.equal(input, '/api/user/transaction-pin'); return response; };
            await assert.rejects(fetchWithTransactionPin('/api/execute-tx', { method: 'POST', body: '{}' }, undefined, async () => { assert.fail('invalid status must not prompt'); }));
            assert.deepEqual(calls, ['/api/user/transaction-pin']);
        }
    } finally { globalThis.fetch = original; }
});

test('reads and nonfinancial settings updates skip setup preflight', async () => {
    const original = globalThis.fetch; const calls = [];
    globalThis.fetch = async (input, init) => { assert.notEqual(input, '/api/user/transaction-pin'); calls.push({ input, init }); return Response.json({ success: true }); };
    try {
        const prompt = async () => { assert.fail('exempt requests must not prompt'); };
        await fetchWithTransactionPin('/api/user/vault/config', {}, undefined, prompt);
        await fetchWithTransactionPin('/api/user/settings', { method: 'POST', body: JSON.stringify({ displayName: 'Alice' }) }, undefined, prompt);
        await fetchWithTransactionPin('/api/user/account', { method: 'PATCH', body: '{}' }, undefined, prompt);
        assert.equal(calls.length, 3);
    } finally { globalThis.fetch = original; }
});

test('payout destination settings still require setup before mutation', async () => {
    const original = globalThis.fetch; let prompted = false;
    globalThis.fetch = async input => { assert.equal(input, '/api/user/transaction-pin'); return Response.json({ configured: false }); };
    try {
        await assert.rejects(fetchWithTransactionPin('/api/user/settings', { method: 'POST', body: JSON.stringify({ payoutDestination: '0xrecipient' }) }, undefined, async () => { prompted = true; throw new DOMException('Cancelled', 'AbortError'); }), { name: 'AbortError' });
        assert.equal(prompted, true);
    } finally { globalThis.fetch = original; }
});

test('cancelling, pausing and revoking authority remain available without setup preflight', async () => {
    const original = globalThis.fetch; const calls = [];
    const requests = [
        ['/api/user/subscription/cancel', 'POST', { subscriptionId: '1' }],
        ['/api/user/vault/cancel-service', 'POST', { merchantAddress: 'merchant' }],
        ['/api/user/commit/halt', 'POST', {}],
        ['/api/user/commit/sub-users/pause', 'POST', { commitId: 'delegate' }],
        ...['pause', 'revoke', 'withdraw'].map(action => ['/api/user/vault/shares/status', 'POST', { action, commitId: 'delegate' }]),
        ['/api/merchant/payroll', 'PUT', { action: 'PAUSE' }],
        ['/api/execute-tx', 'POST', { action: 'cancelSubscription', subscriptionId: '1' }],
    ];
    globalThis.fetch = async input => { assert.notEqual(input, '/api/user/transaction-pin'); calls.push(input); return Response.json({ success: true }); };
    try {
        for (const [input, method, body] of requests) {
            const response = await fetchWithTransactionPin(input, { method, body: JSON.stringify(body) }, undefined, async () => { assert.fail('stopping authority must not prompt'); });
            assert.equal(response.status, 200);
        }
        assert.deepEqual(calls, requests.map(([input]) => input));
    } finally { globalThis.fetch = original; }
});

test('resuming authority and transferring funds still preflight setup', async () => {
    const original = globalThis.fetch;
    const requests = [
        ['/api/user/subscription/resume', 'POST', { subscriptionId: '1' }],
        ['/api/user/vault/resume-service', 'POST', { merchantAddress: 'merchant' }],
        ['/api/user/vault/shares/status', 'POST', { action: 'resume' }],
        ['/api/merchant/payroll', 'PUT', { action: 'RESUME' }],
        ['/api/execute-tx', 'POST', { action: 'transfer' }],
        ['/api/user/wallet/send', 'POST', { recipient: 'alice', amount: '1' }],
    ];
    try {
        for (const [input, method, body] of requests) {
            const calls = []; let prompted = false;
            globalThis.fetch = async path => { calls.push(path); assert.equal(path, '/api/user/transaction-pin'); return Response.json({ configured: false }); };
            await assert.rejects(fetchWithTransactionPin(input, { method, body: JSON.stringify(body) }, undefined, async requestChallenge => { prompted = true; assert.equal(requestChallenge.configured, false); throw new DOMException('Cancelled', 'AbortError'); }), { name: 'AbortError' });
            assert.equal(prompted, true); assert.deepEqual(calls, ['/api/user/transaction-pin']);
        }
    } finally { globalThis.fetch = original; }
});

test('share and sub-user cap changes retain server-required PIN evaluation', async () => {
    const original = globalThis.fetch;
    try {
        for (const input of ['/api/user/vault/shares', '/api/user/commit/sub-users']) {
            const calls = []; let prompted = false;
            globalThis.fetch = async (path, init) => {
                assert.equal(path, input); calls.push(init);
                return calls.length === 1 ? challenge() : Response.json({ success: true });
            };
            const body = JSON.stringify({ commitId: 'delegate', spendLimitUsdc: '100' });
            const response = await fetchWithTransactionPin(input, { method: 'PATCH', body }, undefined, async requestChallenge => {
                prompted = true; assert.equal(calls.length, 1); assert.equal(requestChallenge.configured, true); return 'authorized-cap-increase';
            });
            assert.equal(response.status, 200); assert.equal(prompted, true); assert.equal(calls.length, 2);
            assert.equal(calls[0].body, body); assert.equal(calls[1].body, body);
            assert.equal(calls[1].headers.get('x-transaction-pin-token'), 'authorized-cap-increase');
        }
    } finally { globalThis.fetch = original; }
});
