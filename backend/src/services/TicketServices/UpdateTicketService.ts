import moment from "moment";
import * as Sentry from "@sentry/node";
import CheckContactOpenTickets from "../../helpers/CheckContactOpenTickets";
import SetTicketMessagesAsRead from "../../helpers/SetTicketMessagesAsRead";
import { getIO } from "../../libs/socket";
import Ticket from "../../models/Ticket";
import Setting from "../../models/Setting";
import Queue from "../../models/Queue";
import ShowTicketService from "./ShowTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import { verifyMessage } from "../WbotServices/wbotMessageListener";
import { isNil } from "lodash";
import Whatsapp from "../../models/Whatsapp";
import {
  getProfile,
  profilePsid,
  sendText
} from "../FacebookServices/graphAPI";
import ListSettingsServiceOne from "../SettingServices/ListSettingsServiceOne";
import sendFaceMessage, { sendFacebookMessage } from "../FacebookServices/sendFacebookMessage";
import ShowUserService from "../UserServices/ShowUserService";
import ShowService from "../RatingServices/ShowService";
import User from "../../models/User";
import { TypebotService } from "../../services/typebotServices/typebotServices";
import { FlowiseServices } from "../flowiseServices/flowiseServices";
interface TicketData {
  status?: string;
  userId?: number | null;
  queueId?: number | null;
  isBot?: boolean;
  queueOptionId?: number;
  sendFarewellMessage?: boolean;
  amountUsedBotQueues?: number;
}
interface Request {
  ticketData: TicketData;
  ticketId: string | number;
  companyId: number;
  ratingId: number | undefined;
}
interface Response {
  ticket: Ticket;
  oldStatus: string;
  oldUserId: number | undefined;
}

const UpdateTicketService = async ({
  ticketData,
  ticketId,
  companyId,
  ratingId
}: Request): Promise<Response> => {
  try {
    const { status } = ticketData;
    let { queueId, userId, sendFarewellMessage, amountUsedBotQueues } =
      ticketData;
    let isBot: boolean | null = ticketData.isBot || false;
    let queueOptionId: number | null = ticketData.queueOptionId || null;
    const io = getIO();
    const setting = await Setting.findOne({
      where: { companyId: companyId, key: "userRating" }
    });
    let sendFarewellWaitingTicket = await Setting.findOne({
      where: { key: "sendFarewellWaitingTicket", companyId: companyId }
    });
    const ticket = await ShowTicketService(ticketId, companyId);
    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId,
      companyId,
      whatsappId: ticket.whatsappId,
      ratingId
    });
    if (
      ticket.channel === "whatsapp" ||
      ticket.channel === "instagram" ||
      ticket.channel === "facebook" ||
      ticket.channel === "wppoficial" ||
      ticket.channel === "telegram"
    ) {
      await SetTicketMessagesAsRead(ticket);
    }
    const oldStatus = ticket.status;
    const oldUserId = ticket.user?.id;
    const oldQueueId = ticket.queueId;
    if (oldStatus === "closed") {
      await CheckContactOpenTickets(ticket.contact.id);
      isBot = false;
      queueOptionId = null;
    }
    if (
      ticket.channel === "whatsapp" ||
      ticket.channel === "instagram" ||
      ticket.channel === "facebook" ||
      ticket.channel === "wppoficial"
    ) {
      if (status !== undefined && ["closed"].indexOf(status) > -1) {
        const { complationMessage } = await ShowWhatsAppService(
          ticket.whatsappId,
          companyId
        );
        if (
          setting?.value === "enabled" &&
          ratingId &&
          (sendFarewellMessage || sendFarewellMessage === undefined)
        ) {
          if (ticketTraking.ratingAt == null) {
            const rating = await ShowService(ratingId, companyId);
            if (rating) {
              let { message } = rating;
              message += "\r\n";
              rating.options.forEach(option => {
                message += `\n${option.value} - ${option.name}`;
              });
              if (ticket.channel === "whatsapp") {
                const msg = await SendWhatsAppMessage({
                  body: message,
                  ticket
                });
              }
              if (["facebook", "instagram", "wppoficial", "telegram"].includes(ticket.channel)) {
                console.log(
                  `Checking if ${ticket.contact.number} is a valid ${ticket.channel} contact`
                );
                await sendFacebookMessage({ body: message, ticket });
              }
              await ticketTraking.update({ ratingAt: moment().toDate() });
              io.to("open")
                .to(ticketId.toString())
                .emit(`company-${ticket.companyId}-ticket`, {
                  action: "delete",
                  ticketId: ticket.id
                });
              return { ticket, oldStatus, oldUserId };
            }
          }
          ticketTraking.ratingAt = moment().toDate();
          ticketTraking.rated = false;
        }
        if (
          !isNil(complationMessage) &&
          complationMessage !== "" &&
          (sendFarewellMessage || sendFarewellMessage === undefined)
        ) {
          const _userId = ticket.userId || userId;
          const user = await User.findByPk(_userId);
          let body: any;
          if (
            ticket.status !== "pending" ||
            (ticket.status === "pending" &&
              sendFarewellWaitingTicket?.value === "enabled")
          ) {
            if (user.farewellMessage) {
              body = `\u200e${user.farewellMessage}`;
            } else {
              body = `\u200e${complationMessage}`;
            }
            if (ticket.channel === "whatsapp") {
              await SendWhatsAppMessage({ body, ticket });
            }
            if (["facebook", "instagram", "wppoficial", "telegram"].includes(ticket.channel)) {
              console.log(
                `Checking if ${ticket.contact.number} is a valid ${ticket.channel} contact`
              );
              await sendFacebookMessage({ body, ticket });
            }
          }
        }
        ticketTraking.finishedAt = moment().toDate();
        ticketTraking.whatsappId = ticket.whatsappId;
        ticketTraking.userId = ticket.userId;
        queueId = null;
        userId = null;
      }
    }
    if (queueId !== undefined && queueId !== null) {
      ticketTraking.queuedAt = moment().toDate();
    }
    const settingsTransfTicket = await ListSettingsServiceOne({
      companyId: companyId,
      key: "sendMsgTransfTicket"
    });
    if (settingsTransfTicket?.value === "enabled") {
      if (
        oldQueueId !== queueId &&
        oldUserId === userId &&
        !isNil(oldQueueId) &&
        !isNil(queueId)
      ) {
        const queue = await Queue.findByPk(queueId);
        const wbot = await GetTicketWbot(ticket);
        const msgtxt =
          "*Mensagem automática*:\nVocê foi transferido para o departamento *" +
          queue?.name +
          "*\n¡Aguarde um momento, que iremos te ajudar!";
        if (ticket.channel === "whatsapp") {
          const queueChangedMessage = await wbot.sendMessage(
            `${ticket.contact.number}@${
              ticket.isGroup ? "g.us" : "s.whatsapp.net"
            }`,
            { text: msgtxt }
          );
          await verifyMessage(queueChangedMessage, ticket, ticket.contact);
        }
        if (["facebook", "instagram", "wppoficial", "telegram"].includes(ticket.channel)) {
          await sendFacebookMessage({ body: msgtxt, ticket });
        }
      } else if (
        oldUserId !== userId &&
        oldQueueId === queueId &&
        !isNil(oldUserId) &&
        !isNil(userId)
      ) {
        const wbot = await GetTicketWbot(ticket);
        const nome = await ShowUserService(ticketData.userId);
        const msgtxt =
          "*Mensagem automática*:\nVocê foi transferido ao assistente *" +
          nome.name +
          "*\nAguarde um momento, que iremos te ajudar!";
        const queueChangedMessage = await wbot.sendMessage(
          `${ticket.contact.number}@${
            ticket.isGroup ? "g.us" : "s.whatsapp.net"
          }`,
          { text: msgtxt }
        );
        await verifyMessage(queueChangedMessage, ticket, ticket.contact);
      } else if (
        oldUserId !== userId &&
        !isNil(oldUserId) &&
        !isNil(userId) &&
        oldQueueId !== queueId &&
        !isNil(oldQueueId) &&
        !isNil(queueId)
      ) {
        const wbot = await GetTicketWbot(ticket);
        const queue = await Queue.findByPk(queueId);
        const nome = await ShowUserService(ticketData.userId);
        const msgtxt =
          "*Mensagem automática*:\nVocê foi transferido para departamento *" +
          queue?.name +
          "* você será atendido por *" +
          nome.name +
          "*\n¡Aguarde um momento, que iremos te ajudar!";
        const queueChangedMessage = await wbot.sendMessage(
          `${ticket.contact.number}@${
            ticket.isGroup ? "g.us" : "s.whatsapp.net"
          }`,
          { text: msgtxt }
        );
        await verifyMessage(queueChangedMessage, ticket, ticket.contact);
      } else if (
        oldUserId !== undefined &&
        isNil(userId) &&
        oldQueueId !== queueId &&
        !isNil(queueId)
      ) {
        const queue = await Queue.findByPk(queueId);
        const wbot = await GetTicketWbot(ticket);
        const msgtxt =
          "*Mensagem automática*:\nVocê  foi transferido a um departamento *" +
          queue?.name +
          "*\nAguarde um momento, que iremos te ajudar!";
        const queueChangedMessage = await wbot.sendMessage(
          `${ticket.contact.number}@${
            ticket.isGroup ? "g.us" : "s.whatsapp.net"
          }`,
          { text: msgtxt }
        );
        await verifyMessage(queueChangedMessage, ticket, ticket.contact);
      }
    }
    await ticket.update({
      status,
      queueId,
      userId,
      isBot,
      queueOptionId,
      amountUsedBotQueues:
        status === "closed"
          ? 0
          : amountUsedBotQueues
          ? amountUsedBotQueues
          : ticket.amountUsedBotQueues
    });
    await ticket.reload();
    if (status !== undefined && ["pending"].indexOf(status) > -1) {
      ticketTraking.update({
        whatsappId: ticket.whatsappId,
        queuedAt: moment().toDate(),
        startedAt: null,
        userId: null
      });
    }

    //Reiniciar Bot TypeBot

    if (status !== undefined && ["open"].indexOf(status) > -1) {
      await ticket.contact.updateTypebotToken("");
      
      console.log("TICKET ATUALIZADO!!!!!!!");
      ticketTraking.update({
        startedAt: moment().toDate(),
        ratingAt: null,
        rated: false,
        whatsappId: ticket.whatsappId,
        userId: ticket.userId
      });
    }
    await ticketTraking.save();
    if (ticket.status !== oldStatus || ticket.user?.id !== oldUserId) {
      io.to(oldStatus).emit(`company-${companyId}-ticket`, {
        action: "delete",
        ticketId: ticket.id
      });
    }
    io.to(ticket.status)
      .to("notification")
      .to(ticketId.toString())
      .emit(`company-${companyId}-ticket`, { action: "update", ticket });
    return { ticket, oldStatus, oldUserId };
  } catch (err) {
    Sentry.captureException(err);
  }
};
export default UpdateTicketService;
