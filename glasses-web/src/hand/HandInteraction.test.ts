import { describe, expect, it } from 'vitest';
import { cameraToDisplay, fitCameraToDisplay } from './HandCalibration';
import { PettingGesture } from './PettingGesture';
import { FrameInbox, parsePairing, type HandFrame } from './CameraHands';
import { HandInteraction } from './HandInteraction';
const target = { x: 300, y: 300, visible: true };
const frame = (seq: number, at: number, x = 0.5, y = 0.42): HandFrame => ({ v: 1, type: 'hands', source: 'glasses-camera', streamId: 'test-stream-123', seq, capturedAtMs: at, width: 640, height: 480, coordinateSpace: 'image-top-left', mirrored: false, hands: [{ id: 'right', score: 0.9, points: Array.from({ length: 21 }, () => ({ x, y, z: 0 })) }] });

describe('camera alignment', () => {
  it('fits translation, scale, rotation and reflection without assuming equal camera/display FOV', () => {
    for (const source of [[{x:0.3,y:0.4},{x:0.6,y:0.4},{x:0.45,y:0.7}], [{x:0.6,y:0.3},{x:0.6,y:0.6},{x:0.3,y:0.45}]]) {
      const destination = [{x:230,y:220},{x:370,y:220},{x:300,y:340}];
      const map = fitCameraToDisplay(source, destination)!;
      source.forEach((point, i) => {
        const result = cameraToDisplay(point, map);
        expect(result.x).toBeCloseTo(destination[i]!.x);
        expect(result.y).toBeCloseTo(destination[i]!.y);
      });
    }
  });
  it('rejects repeated/collinear/nonfinite calibration', () => {
    expect(fitCameraToDisplay([{x:0,y:0},{x:0,y:0},{x:1,y:1}])).toBeNull();
    expect(fitCameraToDisplay([{x:0,y:0},{x:0.5,y:0.5},{x:1,y:1}])).toBeNull();
    expect(fitCameraToDisplay([{x:NaN,y:0},{x:0,y:1},{x:1,y:1}])).toBeNull();
  });
  it('requires a fresh steady hand for each alignment point', () => {
    const input = new HandInteraction();
    input.beginCalibration();
    expect(input.confirm(0)).toContain('Hold');
    [0,100,200].forEach((t,i) => input.ingest(frame(i,t), {...target,confidence:1,deltaYaw:0,deltaPitch:0}, t));
    expect(input.confirm(250)).toBeNull();
    expect(input.calibrationIndex).toBe(1);
    expect(input.confirm(300)).toContain('Hold');
  });
});

describe('petting motion', () => {
  it.each([0.5, 2])('preserves stroke and hover behavior at %sx apparent size', scale => {
    const scaledTarget = { ...target, scale };
    const detector = new PettingGesture();
    const replies = [-30, -20, -10, 0, 10].map((x, i) => detector.observe(
      { x: target.x + x * scale, y: target.y - 48 * scale }, scaledTarget, i * 80, 'right',
    ));
    expect(replies.filter(reply => reply.pet)).toHaveLength(1);
    expect(replies.at(-1)?.reachX).toBeCloseTo(1.8);
    const hover = detector.observe({ x: target.x + 80 * scale, y: target.y - 48 * scale }, scaledTarget, 400, 'right');
    expect(hover).toMatchObject({ near: true, pet: false, reachX: 12 });
    expect(hover.reachY).toBeCloseTo(0);
    expect(detector.observe({ x: target.x + 100 * scale, y: target.y - 48 * scale }, scaledTarget, 480, 'right').near).toBe(false);
  });
  it.each([0.5, 2])('does not mistake shared camera motion or a moving target for a stroke at %sx', scale => {
    for (const stationaryHand of [false, true]) {
      const detector = new PettingGesture();
      for (let i = 0; i < 12; i++) {
        const offset = i * 4 * scale;
        expect(detector.observe(
          { x: target.x + (stationaryHand ? 0 : offset), y: target.y - 48 * scale },
          { ...target, x: target.x + offset, scale }, i * 80, 'right',
        ).pet).toBe(false);
      }
    }
  });
  it('restarts stroke accumulation when apparent size changes', () => {
    const detector = new PettingGesture();
    [-30, -20, -10].forEach((x, i) => detector.observe({ x: 300 + x, y: 252 }, target, i * 80, 'right'));
    const replies = [0, 10, 20, 30].map((x, i) => detector.observe(
      { x: 300 + x * 2, y: 204 }, { ...target, scale: 2 }, 240 + i * 80, 'right',
    ));
    expect(replies.every(reply => !reply.pet)).toBe(true);
    expect(detector.observe({ x: 380, y: 204 }, { ...target, scale: 2 }, 560, 'right').pet).toBe(true);
  });
  it('makes a stroke react while preserving the caller’s anchor', () => {
    const detector = new PettingGesture();
    const frozen = Object.freeze({...target});
    const replies = [270,280,290,300,310].map((x,i) => detector.observe({x,y:252}, frozen, i*80, 'right'));
    expect(replies.filter(x=>x.pet)).toHaveLength(1);
    expect(frozen).toEqual(target);
    expect(replies.at(-1)?.reachX).toBeGreaterThan(0);
  });
  it('does not pet for a stationary hand or small jitter', () => {
    const detector = new PettingGesture();
    for (let i=0;i<60;i++) expect(detector.observe({x:300+(i%2),y:252},target,i*100,'right').pet).toBe(false);
  });
  it('does not pet outside the head, out of view, or after a tracking gap', () => {
    for (const y of [100,350]) {
      const detector = new PettingGesture();
      for(let i=0;i<5;i++) expect(detector.observe({x:270+i*10,y},target,i*80,'right').pet).toBe(false);
    }
    const detector = new PettingGesture();
    [0,80,160].forEach((t,i)=>detector.observe({x:270+i*10,y:252},target,t,'right'));
    expect(detector.observe({x:310,y:252},target,700,'right').pet).toBe(false);
    expect(detector.observe({x:320,y:252},{...target,visible:false},780,'right').near).toBe(false);
  });
  it('rejects hand swaps, jumps and fast head motion', () => {
    for (const kind of ['swap','jump','head']) {
      const detector = new PettingGesture();
      for(let i=0;i<5;i++) {
        const result=detector.observe({x:kind==='jump'?270+i*25:270+i*10,y:252},{...target,x:kind==='head'?300+i*10:300},i*(kind==='jump'?10:80),kind==='swap'?String(i):'right');
        expect(result.pet).toBe(false);
      }
    }
  });
  it('expires contact when the stream stops', () => {
    const input = new HandInteraction(); input.map=[600,0,0,0,600,0];
    input.ingest(frame(0,0),{...target,confidence:1,deltaYaw:0,deltaPitch:0},0);
    expect(input.response.near).toBe(true);
    input.expire(351);
    expect(input.response.near).toBe(false);
    expect(input.pointer).toBeNull();
  });
});

describe('camera bridge input', () => {
  it('accepts only fresh glasses frames, and rejects replays and old timestamps', () => {
    const inbox=new FrameInbox();
    expect(inbox.accept({...frame(1,10000),source:'phone-camera'},10000,0)).toBe(false);
    expect(inbox.accept(frame(1,8000),10000,0)).toBe(false);
    expect(inbox.accept(frame(1,10000),10000,0)).toBe(true);
    expect(inbox.accept(frame(1,10001),10001,1)).toBe(false);
    expect(inbox.accept(frame(2,9999),10001,1)).toBe(false);
    expect(inbox.fresh(351)).toBeNull();
    inbox.clear();
    expect(inbox.accept({...frame(0,10001),streamId:'new-stream-123'},10001,400)).toBe(true);
  });
  it('rejects malformed points and excessive hand counts', () => {
    const inbox=new FrameInbox(); const bad=frame(1,1000); bad.hands[0]!.points[8]!.x=NaN;
    expect(inbox.accept(bad,1000,0)).toBe(false);
    const tooMany=frame(1,1000);tooMany.hands.push(tooMany.hands[0]!,tooMany.hands[0]!);
    expect(inbox.accept(tooMany,1000,0)).toBe(false);
  });
  it('requires WSS on the published app and keeps credentials out of endpoint URLs', () => {
    const params=new URLSearchParams({relay:'wss://example.com/ws',room:'a'.repeat(16),token:'b'.repeat(48)});
    expect(parsePairing('#'+params,true)?.relay).toBe('wss://example.com/ws');
    params.set('relay','ws://localhost:8787/ws');
    expect(parsePairing('#'+params,true)).toBeNull();
    expect(parsePairing('#'+params,false)).not.toBeNull();
    params.set('relay','wss://user:pass@example.com/ws');
    expect(parsePairing('#'+params,true)).toBeNull();
  });
});
