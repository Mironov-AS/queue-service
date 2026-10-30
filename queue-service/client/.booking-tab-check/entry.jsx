import React, { act } from "react";
import { createRoot } from "react-dom/client";
import BookingTab from "/home/user/queue-service/client/src/components/admin/BookingTab.jsx";
globalThis.__act = act;
const root = createRoot(document.getElementById("root"));
act(() => { root.render(<BookingTab />); });
