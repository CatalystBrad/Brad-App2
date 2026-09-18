// One place that knows which channels exist. Everything else asks for a channel
// by name and uses the same shape.
import * as whatsapp from './whatsapp.js';
import * as sms from './sms.js';
import * as email from './email.js';

export const CHANNELS = { whatsapp, sms, email };
export const CHANNEL_NAMES = Object.keys(CHANNELS);

/** 'web_only' and 'call_from_solicitor' are not senders - callers check first. */
export const isSendable = (name) => CHANNEL_NAMES.includes(name);

export function getChannel(name) {
  return CHANNELS[name] ?? CHANNELS.whatsapp;
}

/**
 * Fans messages out to the right provider. Without credentials every channel
 * runs dry, recording what it would have sent - which is what makes the whole
 * flow demonstrable and testable offline.
 */
export function createDispatcher(config = {}) {
  const senders = {
    whatsapp: whatsapp.createSender(config.whatsapp ?? {}),
    sms: sms.createSender(config.sms ?? {}),
    email: email.createSender(config.email ?? {}),
  };
  const sent = [];
  return {
    senders,
    sent,
    get dryRun() { return Object.values(senders).every((s) => s.dryRun); },
    /** `sender.send(payload, { channel })` - a single-channel sender ignores the second argument. */
    async send(payload, { channel = 'whatsapp' } = {}) {
      const sender = senders[channel] ?? senders.whatsapp;
      const result = await sender.send(payload);
      sent.push({ channel, payload });
      return result;
    },
    for(channel) { return senders[channel] ?? senders.whatsapp; },
    lastTo(channel) { return [...sent].reverse().find((s) => s.channel === channel)?.payload ?? null; },
  };
}
