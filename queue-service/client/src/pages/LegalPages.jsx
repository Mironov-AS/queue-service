import legalV3 from "./legal-v3.json";
import { Link } from "react-router-dom";

export const ORG_PLACEHOLDERS = {
	name: "Индивидуальный предприниматель Ильинов Сергей Алексеевич",
	inn: "150304643015",
	ogrn: "ОГРНИП: 321265100108420",
	site: "www.maxima-gbo.ru",
	address:
		"Адрес регистрации: 140016, Московская область, г. Люберцы, мкр. Зенино ЖК Самолет, ул. Камова, д. 7, корп. 1, кв. 89. Адрес осуществления деятельности: 140090, Московская область, г. Дзержинский, ул. Энергетиков, д. 32 и д. 34, стр. 1",
	regAddress:
		"140016, Московская область, г. Люберцы, мкр. Зенино ЖК Самолет, ул. Камова, д. 7, корп. 1, кв. 89",
	factAddress:
		"140090, Московская область, г. Дзержинский, ул. Энергетиков, д. 32 и д. 34, стр. 1",
	phone: "8 (925) 845-79-23; 8 (495) 205-15-18; 8 (495) 200-15-18",
	email: "Maxima-gbo@mail.ru",
	responsible:
		"Ильинов Сергей Алексеевич, тел. 8 (925) 845-79-23, e-mail Maxima-gbo@mail.ru",
	processor:
		"Общество с ограниченной ответственностью «ПРОМЕТЕЙ ТЕХНОЛОГИИ», ИНН 9703234369, адрес: 123242, г. Москва, вн. тер. г. муниципальный округ Пресненский, ул. Большая Грузинская, д. 12, стр. 2 (администратор платформы Promto)",
	serverLocation:
		"серверные мощности на территории Российской Федерации (зона msk-1)",
};

function LegalLayout({ title, updated, children }) {
	return (
		<div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8">
			<div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl p-6 sm:p-8">
				<Link
					to="/visitor"
					className="inline-block mb-4 text-sm text-blue-600 hover:text-blue-800"
				>
					← Вернуться к получению талона
				</Link>
				<h1 className="text-2xl font-black text-slate-900 mb-1">{title}</h1>
				<p className="text-xs text-slate-400 mb-6">{updated}</p>
				<div className="space-y-4 text-sm leading-relaxed text-slate-700">
					{children}
				</div>
				<div className="mt-8 pt-4 border-t border-slate-100 flex flex-wrap gap-4 text-sm">
					<Link
						to="/agreement"
						className="text-blue-600 hover:text-blue-800 underline"
					>
						Пользовательское соглашение
					</Link>
					<Link
						to="/privacy"
						className="text-blue-600 hover:text-blue-800 underline"
					>
						Политика обработки персональных данных
					</Link>
					<Link
						to="/consent"
						className="text-blue-600 hover:text-blue-800 underline"
					>
						Согласие на обработку персональных данных
					</Link>
				</div>
			</div>
		</div>
	);
}

function LegalText({ paragraphs }) {
 return paragraphs.map((text, index) => <p key={index}>{text}</p>);
}

export function PrivacyPolicyPage() {
 return <LegalLayout title="Политика обработки персональных данных" updated="Редакция v3 от 30 октября 2026 года"><LegalText paragraphs={legalV3.privacy.slice(1)} /></LegalLayout>;
}

export function ConsentPage() {
 return <LegalLayout title="Согласие на обработку персональных данных" updated="Редакция v3 от 30 октября 2026 года"><LegalText paragraphs={legalV3.consent.slice(1)} /></LegalLayout>;
}
