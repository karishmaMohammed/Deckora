import { resetOutlineFromSeed } from "./outlineStore.ts";

const outline = await resetOutlineFromSeed();
console.log(`Reset outline.json to ${outline.items.length} seed items.`);
