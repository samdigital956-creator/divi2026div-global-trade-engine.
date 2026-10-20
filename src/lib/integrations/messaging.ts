/** Outbound notifications (planned: transactional email, WhatsApp Business Platform). */
export type OutboundMessage = {
  orgId: string;
  to: string;
  template: string; // pre-approved template name (required by WhatsApp)
  variables: Record<string, string>;
};

export interface MessagingChannel {
  readonly id: "email" | "whatsapp" | string;
  send(msg: OutboundMessage): Promise<{ providerMessageId: string }>;
}
