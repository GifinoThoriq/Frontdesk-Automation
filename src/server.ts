import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import { ingestEvents } from './ingest/events';
import { ingestNightLogs } from './ingest/logs';
import { reconcile } from './reconcile';
import { generateHandover } from './generate';
import { renderHTML } from './render';
import { log } from './logger';

const app = express();
app.use(express.json());

const DATA_DIR = path.join(process.cwd(), 'data');
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

/**
 * POST /handover
 * Body: { hotelId?: string, date?: string }
 *
 * date = YYYY-MM-DD of the morning being handed over to (defaults to today)
 * hotelId = hotel identifier (defaults to the one in events.json)
 *
 * Returns: text/html handover report
 */
app.post('/handover', async (req: Request, res: Response) => {
  const requestedDate: string = req.body.date ?? new Date().toISOString().slice(0, 10);
  const requestedHotelId: string | undefined = req.body.hotelId;

  log.info('server', 'Handover request received', { date: requestedDate, hotelId: requestedHotelId });

  try {
    // 1. Ingest
    const { hotelId, hotelName, events: jsonEvents } = ingestEvents(DATA_DIR);
    const effectiveHotelId = requestedHotelId ?? hotelId;

    log.info('server', 'Ingested JSON events', { count: jsonEvents.length, hotelId: effectiveHotelId });

    const logEvents = await ingestNightLogs(DATA_DIR);
    log.info('server', 'Ingested night log events', { count: logEvents.length });

    const allEvents = [...jsonEvents, ...logEvents];

    // 2. Reconcile
    const reconciled = reconcile(effectiveHotelId, allEvents, requestedDate);

    // 3. Generate
    const handover = await generateHandover(reconciled, hotelName);

    // 4. Render
    const html = renderHTML(handover);

    log.info('server', 'Handover served', {
      hotelId: effectiveHotelId,
      shiftDate: requestedDate,
      sections: handover.sections.length,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('server', 'Handover generation failed', { error: message, date: requestedDate });
    res.status(500).json({ error: 'Handover generation failed', detail: message });
  }
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  log.info('server', `Vouch Handover Service started`, { port: PORT });
});

export default app;
