/** Loopback-only capability agent used by one Swirl dedicated server process. */
const http = require('http');
const crypto = require('crypto');

const MAX_BODY = 64 * 1024;

class HostAgent {
  constructor(serverId, handler) {
    this.serverId = serverId;
    this.handler = handler;
    this.token = crypto.randomBytes(32).toString('base64url');
    this.server = null;
  }

  async start() {
    if (this.server) throw new Error('Host agent already started.');
    this.server = http.createServer((request, response) => this.receive(request, response));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    return { port: this.server.address().port, token: this.token };
  }

  async receive(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (
      request.method !== 'POST' ||
      request.url !== '/v1/request' ||
      request.headers.authorization !== `Bearer ${this.token}` ||
      request.headers['x-swirl-server'] !== this.serverId
    ) {
      response.writeHead(404);
      response.end('{"error":"not-found"}');
      return;
    }
    let body = Buffer.alloc(0);
    request.on('data', (chunk) => {
      body = Buffer.concat([body, chunk]);
      if (body.length > MAX_BODY) request.destroy();
    });
    request.on('end', async () => {
      try {
        const requestBody = JSON.parse(body.toString('utf8'));
        if (
          !requestBody ||
          typeof requestBody.operation !== 'string' ||
          requestBody.operation.length > 80 ||
          !/^[a-z][a-z0-9.-]*$/.test(requestBody.operation)
        )
          throw new Error('Invalid host-agent operation.');
        let timer;
        const result = await Promise.race([
          Promise.resolve(this.handler(requestBody.operation, requestBody.payload || {})).finally(
            () => clearTimeout(timer),
          ),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Host-agent operation timed out.')), 30_000);
            timer.unref?.();
          }),
        ]);
        response.writeHead(200);
        response.end(JSON.stringify({ ok: true, result }));
      } catch (error) {
        response.writeHead(400);
        response.end(
          JSON.stringify({ ok: false, error: String(error.message || error).slice(0, 300) }),
        );
      }
    });
  }

  close() {
    const current = this.server;
    this.server = null;
    if (current) current.close();
  }
}

module.exports = HostAgent;
