import { createApp } from "./app.js";
import { getGenerationAdapter } from "./adapters/index.js";

const port = Number(process.env.PORT ?? 4181);
const adapter = getGenerationAdapter();
const app = createApp(adapter);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[realgram-ai-workspace] server listening on :${port} (generation adapter: ${adapter.provider})`,
  );
});
