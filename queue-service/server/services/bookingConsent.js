// Approved consent of the booking widget.
//
// The widget refuses to accept a booking without this text, and every booking
// stores the version and the text that the visitor accepted. A change of the
// agreement requires a new version: the widget then asks the visitor to
// confirm the new text before the booking is accepted.
//
// The wording follows the terms of the user agreement of the service
// (client/src/pages/AgreementPage.jsx). Before the module is enabled on the
// production queue the text must be reviewed by a lawyer.
const bookingConsent = {
	version: "agreement-2026-10-30-v1",
	text:
		"Нажимая кнопку «Записаться», я подтверждаю, что ознакомился(-ась) с " +
		"Пользовательским соглашением сервиса и принимаю его условия, а также даю " +
		"согласие Индивидуальному предпринимателю Ильинову Сергею Алексеевичу " +
		"(ИНН 150304643015) на обработку указанных мной персональных данных в " +
		"объёме и целях, описанных в Пользовательском соглашении и Политике " +
		"обработки персональных данных.",
	agreementUrl: "/agreement",
	policyUrl: "/privacy",
	consentUrl: "/consent",
	agreementTitle: "Пользовательское соглашение",
};

module.exports = { bookingConsent };
