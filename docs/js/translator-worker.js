// Web Worker للترجمة: يبقي الواجهة سريعة أثناء عمل النموذج.
import * as engine from './engine.js';

self.onmessage = async (event) => {
  const msg = event.data || {};
  const { id, type } = msg;
  const reply = (data) => self.postMessage({ id, ...data });
  try {
    switch (type) {
      case 'ping':
        reply({ type: 'pong' });
        break;
      case 'download':
        await engine.ensureModel(msg.key, (p) => reply({ type: 'progress', p }));
        reply({ type: 'done' });
        break;
      case 'translate': {
        const text = await engine.translate(msg.key, msg.text, (done, total) => reply({ type: 'partial', done, total }));
        reply({ type: 'result', text });
        break;
      }
      case 'status':
        reply({ type: 'status', status: await engine.modelStatus() });
        break;
      case 'delete':
        await engine.deleteModel(msg.key);
        reply({ type: 'done' });
        break;
      default:
        reply({ type: 'error', message: 'UNKNOWN_COMMAND' });
    }
  } catch (err) {
    reply({ type: 'error', message: (err && err.message) || String(err) });
  }
};
