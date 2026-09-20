import { once } from 'node:events';
import WebSocket from 'ws';
import { createQuestPhotoVerifier } from '../bridge/quest-verification.mjs';
import { createPlayServer } from '../bridge/play-server.mjs';

const verifier = createQuestPhotoVerifier();
if (!verifier.configured) {
  console.error('Set MODEL_API_KEY in the gitignored .env file. No request was sent.');
  process.exitCode = 1;
} else {
  // Exercise the same /verify path as the phone with two synthetic players.
  // Only blank pixels are sent to Meta; no personal clips or account data.
  const blank = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  let checks = 0;
  const app = createPlayServer({ photoVerifier: { configured: true, async verify(input) {
    checks++;
    console.log(`Server received ${input.frames.length} clip frames for ${input.participantCount} participants; sending to Meta.`);
    return verifier.verify(input);
  } } });
  try {
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    async function join(name) {
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/play');
      await once(socket, 'open');
      const welcome = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Test player could not join the pen.')), 5000);
        socket.on('message', bytes => {
          const message = JSON.parse(bytes);
          if (message.type === 'welcome') { clearTimeout(timeout); resolve(message); }
        });
      });
      socket.send(JSON.stringify({ type: 'lobby', name }));
      return welcome;
    }
    const first = await join('Meta test A');
    await join('Meta test B');
    const response = await fetch(origin + '/verify', {
      method: 'POST', signal: AbortSignal.timeout(40_000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode: first.roomCode, playerToken: first.playerToken,
        questId: 'dapHandshake', frames: [blank, blank, blank], durationSeconds: 3 }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Clip submission returned HTTP ${response.status}: ${result.error}`);
    if (checks !== 1 || typeof result.verified !== 'boolean' || !result.reason || /unreadable result/.test(result.reason)) throw new Error('Meta did not return a usable grading decision.');
    if (result.verified) throw new Error('Meta approved blank evidence; review the verifier before using it for rewards.');
    console.log('Live clip submission succeeded with two players in the pen and no movement or dap action.');
    console.log(`Meta correctly rejected the blank clip: ${result.reason}`);
  } catch (cause) { console.error(cause.message); process.exitCode = 1; }
  finally { await app.close(); }
}
