import { Body, Container, Head, Html, Link, Preview, Text } from "@react-email/components";
import { Footer } from "./components/Footer";
import { Image } from "./components/Image";
import { anchor, container, h1, main, paragraphLight } from "./components/styles";

interface PaymentFailedEmailProps {
  userName?: string;
  planName?: string;
  amount?: number;
  currency?: string;
  nextRetryDate?: string;
  updatePaymentUrl: string;
}

export default function PaymentFailedEmail({
  userName = "there",
  planName = "your plan",
  amount,
  currency = "USD",
  nextRetryDate,
  updatePaymentUrl,
}: PaymentFailedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Payment Failed - Action Required</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={h1}>Payment Failed</Text>

          <Text style={paragraphLight}>
            Hi {userName},
          </Text>

          <Text style={paragraphLight}>
            We were unable to process your subscription payment for {planName}.
            Your subscription is currently past due, and some features may be limited until the payment is successfully processed.
          </Text>

          {amount && (
            <Text style={paragraphLight}>
              Amount: {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency,
              }).format(amount / 100)}
            </Text>
          )}

          {nextRetryDate && (
            <Text style={paragraphLight}>
              We will automatically retry the payment on {nextRetryDate}.
              Please ensure your payment method is up to date to avoid service interruption.
            </Text>
          )}

          <Link
            href={updatePaymentUrl}
            target="_blank"
            style={{
              ...anchor,
              display: "block",
              marginBottom: "50px",
            }}
          >
            Update Payment Method
          </Link>

          <Text style={paragraphLight}>
            If you believe this is an error or need assistance, please contact our support team.
          </Text>

          <Image path="/emails/logo-mono.png" width="120" height="22" alt="app.getcore.me" />
          <Footer />
        </Container>
      </Body>
    </Html>
  );
}
