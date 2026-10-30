import {
	BrowserRouter,
	Routes,
	Route,
	Navigate,
	useLocation,
} from "react-router-dom";
import AdminPage from "./pages/AdminPage";
import BookingPage from "./pages/BookingPage";
import VisitorPage from "./pages/VisitorPage";
import TerminalPage from "./pages/TerminalPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import { PrivacyPolicyPage, ConsentPage } from "./pages/LegalPages";
import AgreementPage from "./pages/AgreementPage";

function RequireAuth({ children }) {
	const token = localStorage.getItem("adminToken");
	const location = useLocation();
	if (!token)
		return <Navigate to="/login" state={{ from: location }} replace />;
	return children;
}

export default function App() {
	return (
		<BrowserRouter
			future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
		>
			<Routes>
				<Route path="/login" element={<LoginPage />} />
				<Route
					path="/admin"
					element={
						<Navigate
							to="/booking/abfbf676-98f5-4dda-960d-57bc4ceaf1bd?date=2026-11-03&time=11:30"
							replace
						/>
					}
				/>
				<Route path="/visitor" element={<VisitorPage />} />
				<Route
					path="/booking/:publicId"
					element={
						import.meta.env.VITE_BOOKING_ENABLED === "true" ? (
							<BookingPage />
						) : (
							<div role="status">Запись временно недоступна</div>
						)
					}
				/>
				<Route path="/terminal" element={<TerminalPage />} />
				<Route path="/privacy" element={<PrivacyPolicyPage />} />
				<Route path="/consent" element={<ConsentPage />} />
				<Route path="/agreement" element={<AgreementPage />} />
				<Route path="/dashboard" element={<DashboardPage />} />
				<Route path="/" element={<Navigate to="/visitor" replace />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</BrowserRouter>
	);
}
