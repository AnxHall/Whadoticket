import gracefulShutdown from "http-graceful-shutdown";
import app from "./app";
import { likeRandomPost } from "./services/InstagramUnoficial/InstaAuth";
import { initIO } from "./libs/socket";
//import { initIO0 } from "./libs/evolution";
import { logger } from "./utils/logger";
import { StartAllWhatsAppsSessions } from "./services/WbotServices/StartAllWhatsAppsSessions";
import Company from "./models/Company";
import { startQueueProcess } from "./queues";
const server = app.listen(process.env.PORT, async () => {
  const companies = await Company.findAll();
  const allPromises: any[] = [];
  companies.map(async c => {
    const promise = StartAllWhatsAppsSessions(c.id);
    allPromises.push(promise);
  });
  Promise.all(allPromises).then(async () => {
    await startQueueProcess();
  });
  logger.info(`Server started on port: ${process.env.PORT}`);
});
process.on("uncaughtException", err => {
  console.error(`${new Date().toUTCString()} uncaughtException:`, err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on("unhandledRejection", (reason, p) => {
  console.error(`${new Date().toUTCString()} unhandledRejection:`, reason, p);
  process.exit(1);
});

/*async function executeLikePost() {
  try {
    await likeRandomPost();
  } catch (error) {
    console.error('Erro ao curtir post no Instagram:', error);
  }
}


executeLikePost();*/

initIO(server);

//initIO0(server);
gracefulShutdown(server);
