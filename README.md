# Realtime Distributed Log Processing System

## Overview

This project simulates a real-time distributed log processing pipeline using an event-driven architecture. It consists of a producer service that generates logs, a Redis-backed queue for asynchronous message passing, and multiple worker services that process logs concurrently with retry logic and a Dead Letter Queue (DLQ) for fault tolerance.

## Tech Stack

- Node.js
- Redis
- Docker & Docker Compose
- Server-Sent Events (SSE)
- HTML/CSS/JavaScript Dashboard

## Architecture

Producer -> Redis Queue -> Worker(s) -> Dashboard (SSE)

## Features

- Asynchronous log ingestion
- Retry mechanism for failed events
- Dead Letter Queue (DLQ)
- Horizontally scalable workers
- Real-time dashboard
- Export visible logs

## How to Run

Bring down any running compose and start fresh:

```bash
docker compose down
docker compose up -d --build
```

Then open:

http://localhost:3000

To scale workers:

```bash
docker compose up -d --scale worker=4
```

## Benchmark Result

Observed ~4x improvement in processing time when scaling from 1 to 4 worker containers for 2000 log events.
