const nodemailer = require('nodemailer');

let transporter;

const parseBool = (value) => String(value).toLowerCase() === 'true';

const getSmtpConfig = () => {
	const host = process.env.SMTP_HOST;
	const port = Number(process.env.SMTP_PORT || 587);
	const user = process.env.SMTP_USER;
	const pass = process.env.SMTP_PASS;

	if (!host || !port || !user || !pass) {
		throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in .env.');
	}

	return {
		host,
		port,
		secure: parseBool(process.env.SMTP_SECURE) || port === 465,
		auth: {
			user,
			pass,
		},
		connectionTimeout: 10000,
		greetingTimeout: 10000,
		socketTimeout: 15000,
	};
};

const getTransporter = () => {
	if (transporter) return transporter;
	transporter = nodemailer.createTransport(getSmtpConfig());
	return transporter;
};

const getFromAddress = () => {
	const fromEmail = process.env.EMAIL_FROM;
	if (!fromEmail) {
		throw new Error('EMAIL_FROM is not configured. Set EMAIL_FROM in .env.');
	}
	const fromName = process.env.EMAIL_FROM_NAME || 'ServiceHub';
	return `"${fromName}" <${fromEmail}>`;
};

const sendMail = async ({ to, subject, text, html }) => {
	if (!to) throw new Error('Recipient email is required');
	if (!subject) throw new Error('Email subject is required');

	const client = getTransporter();
	const from = getFromAddress();

	const info = await client.sendMail({
		from,
		to,
		subject,
		text,
		html,
	});

	return {
		success: true,
		messageId: info.messageId,
	};
};

module.exports = {
	sendMail,
};
