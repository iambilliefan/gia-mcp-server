#!/usr/bin/env node
/**
 * GIA MCP Server — Proxy
 *
 * Transparent MCP bridge that connects Claude Desktop / Claude Code
 * to the hosted GIA governance engine at gia.aceadvising.com.
 *
 * All governance logic executes server-side. This package contains
 * zero governance algorithms — it is a pure protocol relay.
 *
 * Architecture:
 *   Claude <--stdio--> this proxy <--HTTPS--> gia.aceadvising.com/mcp
 *
 * @author Advanced Consulting Experts (ACE)
 * @version 0.2.1
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsResultSchema,
  CallToolResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListResourceTemplatesResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
  CompleteResultSchema,
  EmptyResultSchema,
  type JSONRPCRequest,
} from '@modelcontextprotocol/sdk/types.js';

const VERSION = '0.2.2';
const DEFAULT_SERVER_URL = 'https://gia.aceadvising.com/mcp';

// Result schema map — tells the SDK how to validate upstream responses
const RESULT_SCHEMAS: Record<string, unknown> = {
  'tools/list':                ListToolsResultSchema,
  'tools/call':                CallToolResultSchema,
  'resources/list':            ListResourcesResultSchema,
  'resources/read':            ReadResourceResultSchema,
  'resources/templates/list':  ListResourceTemplatesResultSchema,
  'prompts/list':              ListPromptsResultSchema,
  'prompts/get':               GetPromptResultSchema,
  'completion/complete':       CompleteResultSchema,
  'ping':                      EmptyResultSchema,
  'logging/setLevel':          EmptyResultSchema,
};

function log(msg: string): void {
  process.stderr.write(`[GIA] ${msg}\n`);
}

// Upstream connection state
let upstream: Client | null = null;
let upstreamConnected = false;

async function connectUpstream(apiKey: string, serverUrl: string): Promise<void> {
  log(`Connecting to ${serverUrl}...`);

  const transport = new StreamableHTTPClientTransport(
    new URL(serverUrl),
    {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      },
    }
  );

  upstream = new Client(
    { name: 'gia-mcp-proxy', version: VERSION },
    { capabilities: {} }
  );

  try {
    await upstream.connect(transport);
    upstreamConnected = true;
    log('Connected to upstream GIA server.');

    // Handle upstream errors without crashing
    transport.onerror = (err: Error) => {
      log(`Upstream error: ${err.message}`);
    };

    transport.onclose = () => {
      log('Upstream connection closed. Server remains available — reconnect on next request.');
      upstreamConnected = false;
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`WARNING: Failed to connect to GIA server: ${message}`);
    log('Server is running in disconnected mode.');
    log('Tool calls will return errors until upstream is reachable.');
    upstreamConnected = false;
  }
}

async function main(): Promise<void> {
  // ── Read configuration from environment ──
  const apiKey = process.env.GIA_API_KEY;
  const serverUrl = process.env.GIA_SERVER_URL || DEFAULT_SERVER_URL;

  if (!apiKey) {
    log('ERROR: GIA_API_KEY environment variable is required.');
    log('');
    log('Get your API key at https://gia.aceadvising.com');
    log('Then set it:');
    log('  export GIA_API_KEY=gia_your_key_here');
    log('');
    log('Or configure it in your Claude Desktop / Claude Code settings.');
    process.exit(1);
  }

  // ── Create local stdio server FIRST (so health checks work) ──
  const local = new Server(
    { name: 'gia-mcp-server', version: VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // ── Bridge: forward requests to upstream (or return error if disconnected) ──
  local.fallbackRequestHandler = async (request: JSONRPCRequest) => {
    const method = request.method;
    const params = request.params ?? {};
    const schema = RESULT_SCHEMAS[method];

    if (!schema) {
      throw new Error(`Unsupported method: ${method}`);
    }

    // Ping always succeeds locally — keeps the server alive for health checks
    if (method === 'ping') {
      return {};
    }

    if (!upstreamConnected || !upstream) {
      // Try to reconnect on demand
      await connectUpstream(apiKey, serverUrl);
    }

    // When disconnected, return empty results for discovery methods
    // so health checks and tool listing still work
    if (!upstreamConnected || !upstream) {
      const disconnectedMsg = `[GIA disconnected] Connect to ${serverUrl} with a valid GIA_API_KEY to enable tools.`;
      switch (method) {
        case 'tools/list':
          return { tools: [{ name: 'gia_system_status', description: disconnectedMsg, inputSchema: { type: 'object', properties: {} } }] };
        case 'resources/list':
          return { resources: [] };
        case 'resources/templates/list':
          return { resourceTemplates: [] };
        case 'prompts/list':
          return { prompts: [] };
        case 'logging/setLevel':
          return {};
        default:
          throw new Error(
            'GIA upstream server is not reachable. Check your GIA_API_KEY and network connection. ' +
            `Server URL: ${serverUrl}`
          );
      }
    }

    const result = await (upstream as any).request(
      { method, params },
      schema
    );

    return result;
  };

  // Forward notifications from Claude to upstream
  local.fallbackNotificationHandler = async (notification) => {
    if (!upstreamConnected || !upstream) return;
    try {
      await (upstream as any).notification({
        method: notification.method,
        params: notification.params,
      });
    } catch {
      // Notifications are fire-and-forget; don't crash on failure
    }
  };

  // ── Start stdio transport ──
  const stdioTransport = new StdioServerTransport();
  await local.connect(stdioTransport);

  log(`GIA Governance MCP Proxy v${VERSION}`);
  log(`Upstream: ${serverUrl}`);
  log('Transport: stdio <-> HTTPS');
  log('Ready.');

  // ── Now connect upstream (non-fatal) ──
  await connectUpstream(apiKey, serverUrl);

  // ── Graceful shutdown ──
  const shutdown = async (): Promise<void> => {
    log('Shutting down...');
    try {
      await local.close();
      if (upstream) await upstream.close();
    } catch {
      // Best-effort cleanup
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  log(`FATAL: ${message}`);
  process.exit(1);
});
