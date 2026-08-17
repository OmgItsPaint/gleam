/**
 * Read-only DNS guidance for people connecting a domain to a Swirl server.
 * It uses the operating system resolver and never changes DNS, router, or firewall settings.
 */
const dns = require('dns');
const { domainToASCII } = require('url');

const EMPTY_CODES = new Set(['ENODATA', 'ENOTFOUND', 'ENODOMAIN', 'ESERVFAIL']);

class ServerDomainService {
  constructor(resolver = dns.promises) {
    this.resolver = resolver;
  }

  hostname(value) {
    const input = String(value || '')
      .trim()
      .replace(/\.$/, '');
    if (!input || input.length > 253 || /[\s/:?#@]/.test(input))
      throw new Error('Enter only a domain name, such as play.example.com.');
    const hostname = domainToASCII(input).toLowerCase();
    if (
      !hostname ||
      hostname.length > 253 ||
      !hostname.includes('.') ||
      hostname
        .split('.')
        .some(
          (label) =>
            !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
        )
    )
      throw new Error('Enter a complete domain name with valid DNS labels.');
    return hostname;
  }

  port(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Choose a server port from 1024 to 65535.');
    return port;
  }

  async optional(method, value) {
    try {
      const result = await this.resolver[method](value);
      return Array.isArray(result) ? result : [];
    } catch (error) {
      if (EMPTY_CODES.has(error?.code)) return [];
      throw new Error(
        `DNS lookup failed: ${String(error?.code || error?.message || 'unknown error')}`,
      );
    }
  }

  async diagnose(value, requestedPort) {
    const hostname = this.hostname(value);
    const port = this.port(requestedPort);
    const serviceName = `_minecraft._tcp.${hostname}`;
    const [ipv4, ipv6, serviceRecords] = await Promise.all([
      this.optional('resolve4', hostname),
      this.optional('resolve6', hostname),
      this.optional('resolveSrv', serviceName),
    ]);
    const matchingService = serviceRecords.some(
      (record) =>
        Number(record.port) === port &&
        String(record.name || '')
          .replace(/\.$/, '')
          .toLowerCase() === hostname,
    );
    const addressReady = ipv4.length > 0 || ipv6.length > 0;
    const standardPort = port === 25565;
    const checks = [
      {
        level: addressReady ? 'pass' : 'warn',
        title: addressReady ? 'Domain resolves' : 'Address record not found',
        detail: addressReady
          ? `${ipv4.length} IPv4 and ${ipv6.length} IPv6 address record${ipv4.length + ipv6.length === 1 ? '' : 's'} found.`
          : 'Add an A record for your public IPv4 address or an AAAA record for your public IPv6 address.',
      },
      {
        level: standardPort || matchingService ? 'pass' : 'warn',
        title: standardPort
          ? 'Default Minecraft port'
          : matchingService
            ? 'Minecraft service record matches'
            : 'Service record needed',
        detail: standardPort
          ? 'Players can use the domain without typing a port once the address record and router are ready.'
          : matchingService
            ? `The SRV record points ${hostname} to port ${port}.`
            : `Add an SRV record so players do not need to type :${port}.`,
      },
    ];
    if (serviceRecords.length && !matchingService)
      checks.push({
        level: 'warn',
        title: 'Existing SRV record does not match',
        detail: `The existing Minecraft service record does not target ${hostname} on port ${port}.`,
      });
    return {
      hostname,
      port,
      ready: addressReady && (standardPort || matchingService),
      checks,
      records: {
        address: {
          type: 'A or AAAA',
          name: hostname,
          value: 'Your router public IP address',
        },
        service: standardPort
          ? null
          : {
              type: 'SRV',
              name: serviceName,
              priority: 0,
              weight: 0,
              port,
              target: hostname,
            },
      },
      note: 'DNS only gives the server a name. Your router and organization must still allow the server port; Swirl does not bypass network policy.',
    };
  }
}

module.exports = ServerDomainService;
