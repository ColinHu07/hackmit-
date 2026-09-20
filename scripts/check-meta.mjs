import { createQuestPhotoVerifier } from '../bridge/quest-verification.mjs';
const verifier = createQuestPhotoVerifier();
if (!verifier.configured) {
  console.error('Set MODEL_API_KEY in the gitignored .env file. No request was sent.');
  process.exitCode = 1;
} else {
  // Synthetic blank pixel only: this checks the live vision request without uploading personal media.
  const photoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  try {
    const result = await verifier.verify({ questId: 'touchGrass', photoDataUrl });
    if (result.verified) throw new Error('The model approved a blank image. Do not use it for quest rewards until the verifier is reviewed.');
    console.log('Live Meta vision request succeeded and correctly rejected blank evidence.');
    console.log(result.reason);
  } catch (cause) { console.error(cause.message); process.exitCode = 1; }
}
