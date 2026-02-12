const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); 
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// --- CONFIGURACIÓN DE TUS DATOS ---
const FORMSPARK_ID = "s3W9mo046"; 
const GOOGLE_CLIENT_ID = "267546833261-409nh69hngn8j1tbqaps1m2lubo77cfr.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";
const GOOGLE_REFRESH_TOKEN = "1//04Jm-T21-bKv3CgYIARAAGAQSNwF-L9IrM7CztZZNPBdOXcC1BAh73EMJhV84RcVmc_J_5q5rDGaH1HNJVQVktuKs21ZAhT9HNKM";

const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: 'uploads/' }); 

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- GOOGLE CALENDAR CONFIG ---
const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);
oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

app.get('/api/disponibilidad', async (req, res) => {
    const { start, end } = req.query; 
    try {
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: start,
            timeMax: end,
            singleEvents: true,
            orderBy: 'startTime',
        });
        const ocupados = response.data.items.map(event => ({
            inicio: event.start.dateTime || event.start.date,
            fin: event.end.dateTime || event.end.date
        }));
        res.json(ocupados);
    } catch (error) {
        console.error("Error disponibilidad:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/agenda', upload.single('foto'), async (req, res) => {
    const { nombre, telefono, fecha, horaInicio, horaFin, zona, googleStart, googleEnd } = req.body;

    if (!nombre || !googleStart || !googleEnd || googleStart === "undefined") {
        console.error("⚠️ Intento de reserva con datos incompletos.");
        return res.status(400).json({ error: "Faltan datos esenciales." });
    }

    try {
        const timeMinISO = new Date(googleStart).toISOString();
        const timeMaxISO = new Date(googleEnd).toISOString();

        // 1. Verificación de colisión
        const checkEvents = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMinISO,
            timeMax: timeMaxISO,
            singleEvents: true,
        });

        if (checkEvents.data.items && checkEvents.data.items.length > 0) {
            return res.status(400).json({ success: false, error: "Horario ya ocupado." });
        }

        // 2. Respuesta al cliente
        res.status(200).json({ success: true, message: "¡Horario reservado!" });

        // 3. Ejecución de tareas (Quitamos setImmediate para asegurar que Render no mate el proceso)
        console.log(`🚀 Procesando reserva para: ${nombre}`);

        // Enviar a Formspark
        const enviarFormspark = fetch(`https://submit-form.com/${FORMSPARK_ID}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({
                _subject: `🔥 NUEVO TURNO: ${nombre}`,
                nombre, telefono, fecha, horario: `${horaInicio} - ${horaFin}`, zona
            })
        }).then(() => console.log("✅ Formspark enviado")).catch(e => console.error("❌ Error Formspark:", e.message));

        // Crear evento en Google
        const crearEvento = calendar.events.insert({
            calendarId: 'primary',
            resource: {
                summary: `💈 ${nombre} - LDMS`,
                description: `Tel: ${telefono} | Zona: ${zona}`,
                start: { dateTime: timeMinISO, timeZone: 'America/Argentina/Buenos_Aires' },
                end: { dateTime: timeMaxISO, timeZone: 'America/Argentina/Buenos_Aires' },
            }
        }).then(() => console.log("✅ Google Calendar actualizado")).catch(e => console.error("❌ Error Google Calendar:", e.message));

        // Esperamos que ambas terminen en segundo plano
        Promise.all([enviarFormspark, crearEvento]);

    } catch (error) {
        console.error("❌ Error crítico en /api/agenda:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: "Error interno." });
        }
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor LDMS STUDIO funcionando en puerto ${PORT}`);
});