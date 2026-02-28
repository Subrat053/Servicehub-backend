/**
 * WhatsApp Business API Integration – Meta Cloud API
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 *
 * Required .env variables:
 *   WHATSAPP_PHONE_NUMBER_ID   – from Meta Business Manager > WhatsApp > Phone Numbers
 *   WHATSAPP_ACCESS_TOKEN      – Permanent token from System User in Meta Business Manager
 *
 * Optional .env variables:
 *   WHATSAPP_OTP_TEMPLATE_NAME   – Pre-approved OTP template name (e.g. "servicehub_otp")
 *   WHATSAPP_OTP_TEMPLATE_LANG   – Template language code (default: "en")
 *   WHATSAPP_WELCOME_TEMPLATE_NAME – Pre-approved welcome template name
 *   WHATSAPP_DEV_MODE            – Set "true" to skip API calls and print OTP to console
 */

const WHATSAPP_API_VERSION = 'v21.0';

/* ─────────────────────────────────────────────
   OTP Generator
───────────────────────────────────────────── */
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

/* ─────────────────────────────────────────────
   Phone number → E.164 (digits only, no +)
   e.g.  "09876543210"  → "919876543210"
         "+91 98765 43210" → "919876543210"
         "9876543210"    → "919876543210"  (assumes India)
───────────────────────────────────────────── */
const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  // Strip spaces, dashes, parens
  let n = phone.replace(/[\s\-\(\)]/g, '');
  // Strip leading +
  if (n.startsWith('+')) n = n.slice(1);
  // Leading 0 → India country code
  if (n.startsWith('0')) n = '91' + n.slice(1);
  // Bare 10-digit number → India
  if (/^\d{10}$/.test(n)) n = '91' + n;
  return n;
};

/* ─────────────────────────────────────────────
   Internal: POST to Meta WhatsApp Cloud API
───────────────────────────────────────────── */
const callWhatsAppAPI = async (payload) => {
  const accessToken  = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const unconfigured =
    !accessToken  || accessToken  === 'your_whatsapp_access_token'  ||
    !phoneNumberId || phoneNumberId === 'your_whatsapp_phone_number_id';

  if (unconfigured) {
    throw new Error(
      'WhatsApp Business API not configured. ' +
      'Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in your .env file.'
    );
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('[WhatsApp API Error]', JSON.stringify(data));
    throw new Error(
      data?.error?.message || `WhatsApp API request failed (HTTP ${response.status})`
    );
  }

  return data;
};

/* ─────────────────────────────────────────────
   Send OTP via WhatsApp
   – Uses approved OTP template if configured
   – Falls back to plain text message
───────────────────────────────────────────── */
const sendPhoneOTP = async (phone, otp) => {
  const to = formatPhoneNumber(phone);

  // ── Dev mode: just print to console ──────────────────────
  if (process.env.WHATSAPP_DEV_MODE === 'true') {
    console.log('\n╔══════════════════════════════╗');
    console.log('║  WhatsApp OTP  (DEV MODE)    ║');
    console.log(`║  To   : +${to.padEnd(20)}║`);
    console.log(`║  OTP  : ${otp.padEnd(22)}║`);
    console.log('║  Valid: 10 minutes           ║');
    console.log('╚══════════════════════════════╝\n');
    return { success: true, devMode: true };
  }

  // ── Template-based OTP (recommended for production) ──────
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME;
  const templateLang = process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en';
  const hasTemplate  = templateName && templateName !== 'your_otp_template_name';

  if (hasTemplate) {
    /**
     * Your OTP template body must contain {{1}} for the OTP code.
     * If the template also has a "Copy Code" URL button, uncomment the button component below.
     *
     * Example template body: "Your ServiceHub code is {{1}}. Valid 10 minutes."
     */
    await callWhatsAppAPI({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: otp }],
          },
          // ── Uncomment if your template has a "Copy Code" button ──
          // {
          //   type: 'button',
          //   sub_type: 'url',
          //   index: '0',
          //   parameters: [{ type: 'text', text: otp }],
          // },
        ],
      },
    });
  } else {
    /**
     * Fallback: plain text – works only within the 24-hour customer service window
     * (i.e., the user must have messaged your WhatsApp number first).
     * For a fully outbound OTP flow, get an approved authentication template.
     */
    await callWhatsAppAPI({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body:
          `🔐 *ServiceHub Verification*\n\n` +
          `Your OTP is: *${otp}*\n\n` +
          `Valid for 10 minutes. Do not share this code with anyone.\n\n` +
          `_– ServiceHub Team_`,
      },
    });
  }

  console.log(`[WhatsApp OTP] Sent to +${to}`);
  return { success: true, message: 'OTP sent via WhatsApp' };
};

/* ─────────────────────────────────────────────
   Send Email OTP
   TODO: Replace with real service (Nodemailer / SendGrid / Resend)
───────────────────────────────────────────── */
const sendEmailOTP = async (email, otp) => {
  console.log(`[Email OTP] ${otp} → ${email}`);
  return { success: true, message: 'OTP sent via email' };
};

/* ─────────────────────────────────────────────
   Send a WhatsApp template message (e.g. welcome)
───────────────────────────────────────────── */
const sendWhatsAppMessage = async (phone, templateKey, data = {}) => {
  const to = formatPhoneNumber(phone);

  if (process.env.WHATSAPP_DEV_MODE === 'true') {
    console.log(`[WhatsApp Template DEV] key="${templateKey}" to=+${to}`, data);
    return { success: true, devMode: true };
  }

  // Map internal keys to actual Meta-approved template names
  const templateMap = {
    welcome: process.env.WHATSAPP_WELCOME_TEMPLATE_NAME || null,
  };

  const templateName = templateMap[templateKey] || templateKey;
  const unconfigured = !templateName || templateName === 'your_welcome_template_name';

  if (unconfigured) {
    console.log(`[WhatsApp] Skipping template "${templateKey}" – not configured`);
    return { success: false, reason: 'Template not configured' };
  }

  try {
    await callWhatsAppAPI({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: data?.name
          ? [{ type: 'body', parameters: [{ type: 'text', text: data.name }] }]
          : [],
      },
    });
    console.log(`[WhatsApp Template] "${templateName}" sent to +${to}`);
    return { success: true };
  } catch (error) {
    console.error(`[WhatsApp Template Error] "${templateName}":`, error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  generateOTP,
  sendPhoneOTP,
  sendEmailOTP,
  sendWhatsAppMessage,
  formatPhoneNumber,
};
