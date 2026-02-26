import express from "express";
import { createClient } from "redis";
import crypto from "crypto";

const app = express();
app.use(express.json());
// serve static dashboard from / (mounted by docker-compose)
app.use(express.static("/app/dashboard"));

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redis = createClient({ url: REDIS_URL });

redis.on("error", (err) => console.error("Redis error:", err));

await redis.connect();
console.log("Producer connected to Redis");

// SSE clients
const sseClients = new Set();

app.get('/stream', (req, res) => {
	res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
	res.flushHeaders && res.flushHeaders();
	res.write('\n');
	sseClients.add(res);
	req.on('close', () => sseClients.delete(res));
});

app.post("/log", async (req, res) => {
	const event = {
		id: crypto.randomUUID(),
		level: req.body.level || "INFO",
		message: req.body.message || "default log",
		service: req.body.service || "api",
		timestamp: Date.now(),
	};

	await redis.rPush("log_queue", JSON.stringify(event));

	// broadcast to SSE clients
	for (const client of sseClients) {
		try { client.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) {}
	}
	res.json({ queued: true });
});

app.post("/generate", async (req, res) => {
	const count = Number(req.body.count || 50);

	for (let i = 0; i < count; i++) {
		const event = {
			id: crypto.randomUUID(),
			level: "INFO",
			message: `log ${i}`,
			service: "api",
			timestamp: Date.now(),
		};

		await redis.rPush("log_queue", JSON.stringify(event));

			// broadcast to SSE clients
			for (const client of sseClients) {
				try { client.write(`data: ${JSON.stringify(event)}\n\n`); } catch (e) {}
			}
	}

	res.json({ queued: count });
});

app.listen(3000, () => {
	console.log("Producer running on port 3000");
});
