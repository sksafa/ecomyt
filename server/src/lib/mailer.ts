import nodemailer, { type Transporter } from "nodemailer";
import { env, isTest } from "../config/env.js";
import { logger } from "./logger.js";

let transporter: Transporter | null = null;

export const outbox: { to: string; subject: string; text: string }[] = []; // inspected by tests

/** Sends via SMTP_URL when configured; otherwise logs (development) so flows stay testable. */
export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (isTest) {
    outbox.push({ to, subject, text });
    return { delivered: false, logged: true };
  }
  if (!env.SMTP_URL) {
    logger.info({ to, subject, text }, "email (SMTP not configured – logged only)");
    return { delivered: false, logged: true };
  }
  transporter ??= nodemailer.createTransport(env.SMTP_URL);
  await transporter.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  return { delivered: true, logged: false };
}
