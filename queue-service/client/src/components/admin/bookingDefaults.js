// Default booking configuration for a service that has not been configured yet.
// Used when the booking channel is switched on before the schedule is set up.
export const defaultBookingConfig = () => ({
	enabled: false,
	duration_minutes: 30,
	capacity: 1,
	timezone: "Europe/Moscow",
	schedule: [1, 2, 3, 4, 5].map((day) => ({
		day,
		start: "09:00",
		end: "18:00",
	})),
	exceptions: [],
	fields: [],
});
