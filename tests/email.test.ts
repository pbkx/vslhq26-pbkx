import { afterEach, describe, expect, it } from "vitest";
import { AzureCommunicationEmailService } from "../src/services/emailService.js";

const originalConnection =
  process.env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING;
const originalSender = process.env.EMAIL_SENDER_ADDRESS;

afterEach(() => {
  if (originalConnection === undefined) {
    delete process.env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING;
  } else {
    process.env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING =
      originalConnection;
  }
  if (originalSender === undefined) {
    delete process.env.EMAIL_SENDER_ADDRESS;
  } else {
    process.env.EMAIL_SENDER_ADDRESS = originalSender;
  }
});

describe("ACS Email", () => {
  it("fails closed when delivery credentials are not configured", async () => {
    delete process.env.AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING;
    delete process.env.EMAIL_SENDER_ADDRESS;

    const result = await new AzureCommunicationEmailService().send({
      to: "demo@example.org",
      subject: "GrantPilot",
      plainText: "Test",
      html: "<p>Test</p>",
    });

    expect(result).toEqual({
      provider: "azure-communication-services",
      status: "failed",
      error: "Azure Communication Services email delivery is not configured.",
    });
  });
});
