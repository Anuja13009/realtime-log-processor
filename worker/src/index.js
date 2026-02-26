import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const WORKER_ID = process.env.WORKER_ID || "worker";
const redis = createClient({ url: REDIS_URL });
redis.on("error", (err) => console.error("Redis error:", err));

await redis.connect();
console.log("Worker connected to Redis");
console.log("Listening for log events...");

console.log(`[${WORKER_ID}] delay=50ms, reportEvery=2s`);

let processedSinceLastReport = 0;
let localCount = 0; // counts handled events per worker (used for OK log frequency)

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// report throughput every 2 seconds
setInterval(() => {
	const count = processedSinceLastReport;
	const eps = (count / (2000 / 1000)).toFixed(1);
	console.log(`[${WORKER_ID}] Throughput: ${count} events / 2s (~${eps} events/sec)`);
	processedSinceLastReport = 0;
}, 2000);

const FAIL_RATE = 0.7; // kept for reference, deterministic logic used below

async function tryProcess(event) {
	// simulate processing delay (50ms)
	await delay(50);
	// deterministic failure: extract number from message like "log 3"
	const n = Number(String(event.message).split(" ")[1]);
	const shouldFail = Number.isFinite(n) && n % 3 === 0;
	if (shouldFail) {
		throw new Error("Deterministic failure");
	}
	// success: return to caller
	return;
}

// main queue loop: process events and on failure push to retry_queue
async function mainLoop() {
	while (true) {
		try {
			const res = await redis.blPop("log_queue", 0);
			const raw = res?.element ?? (Array.isArray(res) ? res[1] : null);
			if (!raw) continue;
			let event;
			try {
				event = JSON.parse(raw);
			} catch (e) {
				// count bad JSON as handled
				processedSinceLastReport += 1;
				console.log(`[${WORKER_ID}] BAD_JSON (ignored)`);
				continue;
			}

			// count this popped item as handled exactly once
			processedSinceLastReport += 1;

			// increment attempt count for this processing try
			event.attempt = (event.attempt ?? 0) + 1;

			try {
				await tryProcess(event);
				// success: increment local counter and occasionally log OK
				localCount += 1;
				if (localCount % 10 === 0) {
					console.log(`[${WORKER_ID}] OK attempt ${event.attempt}: ${event.id} ${event.level} ${event.service} ${event.message}`);
				}
			} catch (err) {
				if (event.attempt < 3) {
					await redis.rPush("retry_queue", JSON.stringify(event));
					console.log(`[${WORKER_ID}] FAIL attempt ${event.attempt} -> retry_queue: ${event.id}`);
				} else {
					await redis.rPush("dead_letter_queue", JSON.stringify(event));
					console.log(`[${WORKER_ID}] DLQ after 3 attempts: ${event.id}`);
				}
			}
		} catch (err) {
			await delay(500);
		}
	}
}

// retry loop: BLPOP retry_queue and retry processing
async function retryLoop() {
	while (true) {
		try {
			const res = await redis.blPop("retry_queue", 0);
			const raw = res?.element ?? (Array.isArray(res) ? res[1] : null);
			if (!raw) continue;
			let event;
			try {
				event = JSON.parse(raw);
			} catch (e) {
				// count bad JSON as handled
				processedSinceLastReport += 1;
				console.log(`[${WORKER_ID}] BAD_JSON (ignored)`);
				continue;
			}

			// count this popped retry item as handled exactly once
			processedSinceLastReport += 1;

			// increment attempt for this retry try
			event.attempt = (event.attempt ?? 0) + 1;
			console.log(`[${WORKER_ID}] RETRY attempt ${event.attempt} for ${event.id}`);

			try {
				await tryProcess(event);
				// success on retry
				localCount += 1;
				if (localCount % 10 === 0) {
					console.log(`[${WORKER_ID}] OK attempt ${event.attempt}: ${event.id} ${event.level} ${event.service} ${event.message}`);
				}
			} catch (err) {
				if (event.attempt < 3) {
					await redis.rPush("retry_queue", JSON.stringify(event));
					console.log(`[${WORKER_ID}] FAIL attempt ${event.attempt} -> retry_queue: ${event.id}`);
				} else {
					await redis.rPush("dead_letter_queue", JSON.stringify(event));
					console.log(`[${WORKER_ID}] DLQ after 3 attempts: ${event.id}`);
				}
			}
		} catch (err) {
			await delay(500);
		}
	}
}

// start loops concurrently (minimal logs only)
mainLoop();
retryLoop();
