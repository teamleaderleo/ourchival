import { httpRouter } from "convex/server";

const http = httpRouter();

// Future endpoint:
// POST /capture
// - accepts extension captures
// - creates reference/source snapshot
// - uploads asset or schedules asset ingestion

export default http;
