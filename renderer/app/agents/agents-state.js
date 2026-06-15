// ============================================================================
// AGENTS (Sub-agents) v1 — project-scoped `.claude/agents/*.md`
// ============================================================================
let availableAgents = []; // [{ id, name, description, instructions, sourcePath }]
let activeAgentIdBySession = {}; // { [sessionId]: agentId }

