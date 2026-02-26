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
 * @author ACE Advising
 * @version 0.2.1
 */
export {};
