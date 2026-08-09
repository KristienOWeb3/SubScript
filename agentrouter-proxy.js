const http = require('http');
const https = require('https');

const PORT = 3456;
const TARGET_HOST = 'agentrouter.org';

function sanitizeMessage(json) {
    if (json.billing) delete json.billing;

    if (Array.isArray(json.content)) {
        // Strip out 'thinking' blocks that contain non-standard signature attributes
        json.content = json.content.filter(block => block.type !== 'thinking');
    }
    return json;
}

const server = http.createServer((req, res) => {
    const options = {
        hostname: TARGET_HOST,
        port: 443,
        path: req.url,
        method: req.method,
        headers: {
            ...req.headers,
            host: TARGET_HOST,
            'User-Agent': 'claude-cli/2.1.119 (external, cli)',
            'anthropic-beta': req.headers['anthropic-beta'] || 'claude-code-20250219'
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        const isEventStream = (proxyRes.headers['content-type'] || '').includes('text/event-stream');

        const headers = { ...proxyRes.headers };
        if (!isEventStream) delete headers['content-length'];

        res.writeHead(proxyRes.statusCode, headers);

        let bodyBuffer = '';

        proxyRes.on('data', (chunk) => {
            if (isEventStream) {
                // If SSE stream, filter out billing_summary / thinking lines if needed
                res.write(chunk);
            } else {
                bodyBuffer += chunk.toString('utf8');
            }
        });

        proxyRes.on('end', () => {
            if (!isEventStream) {
                try {
                    let json = JSON.parse(bodyBuffer);
                    json = sanitizeMessage(json);
                    res.end(JSON.stringify(json));
                } catch (e) {
                    res.end(bodyBuffer);
                }
            } else {
                res.end();
            }
        });
    });

    proxyReq.on('error', (err) => {
        console.error('Proxy error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    });

    req.pipe(proxyReq);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`AgentRouter compatibility proxy active at http://127.0.0.1:${PORT}`);
});
