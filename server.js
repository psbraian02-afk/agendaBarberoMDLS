const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); 
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// --- CONFIGURACIÓN DE TUS NUEVOS DATOS ---
const FORMSPARK_ID = "s3W9mo046"; 
const GOOGLE_CLIENT_ID = "267546833261-409nh69hngn8j1tbqaps1m2lubo77cfr.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "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";
const GOOGLE_REFRESH_TOKEN = "1//04Jm-T21-bKv3CgYIARAAGAQSNwF-L9IrM7CztZZNPBdOXcC1BAh73EMJhV84RcVmc_J_5q5rDGaH1HNJVQVktuKs21ZAhT9HNKM";

// Configuración de archivos
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: 'uploads/' }); 

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- CONFIGURACIÓN GOOGLE CALENDAR ---
const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Consultar disponibilidad real
app.get('/api/disponibilidad', async (req, res) => {
    const { start, end } = req.query; 
    try {
        oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
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
        console.error("❌ Error disponibilidad:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/agenda', upload.single('foto'), async (req, res) => {
    console.log("--- NUEVA SOLICITUD RECIBIDA ---");
    const { nombre, telefono, fecha, horaInicio, horaFin, zona, googleStart, googleEnd } = req.body;

    if (!nombre || !googleStart || !googleEnd || googleStart === "undefined") {
        console.error("❌ Error: Faltan datos esenciales.");
        return res.status(400).json({ error: "Faltan datos esenciales (Fecha u Hora)." });
    }

    try {
        oauth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

        console.log("🔍 Consultando disponibilidad en Google...");
        const timeMinISO = new Date(googleStart).toISOString();
        const timeMaxISO = new Date(googleEnd).toISOString();

        const checkEvents = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMinISO,
            timeMax: timeMaxISO,
            singleEvents: true,
        });

        if (checkEvents.data.items && checkEvents.data.items.length > 0) {
            console.log(`🚫 Horario ocupado para ${nombre}`);
            return res.status(400).json({ 
                success: false, 
                error: "Lo siento, este horario ya fue reservado. Elige otro." 
            });
        }

        res.status(200).json({ success: true, message: "¡Horario reservado!" });

        // --- SEGUNDO PLANO ---
        const procesarSegundoPlano = async () => {
            // Enviar a Formspark actualizado
            const datosFormspark = {
                _subject: `🔥 Turno Confirmado: ${nombre}`,
                nombre, telefono, fecha, horario: `${horaInicio} - ${horaFin}`, zona
            };

            fetch(`https://submit-form.com/${FORMSPARK_ID}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(datosFormspark)
            }).catch(e => console.error("Error Formspark:", e.message));

            // Crear evento en Google
            const event = {
                summary: `Cita: ${nombre}`,
                description: `Tel: ${telefono} | Detalles: ${zona}`,
                start: { dateTime: timeMinISO, timeZone: 'America/Argentina/Buenos_Aires' },
                end: { dateTime: timeMaxISO, timeZone: 'America/Argentina/Buenos_Aires' },
            };

            try {
                await calendar.events.insert({ calendarId: 'primary', resource: event });
                console.log("📅 Evento creado exitosamente en Google Calendar.");
            } catch (err) {
                console.error("❌ Error al insertar en Calendar:", err.message);
            }
        };

        procesarSegundoPlano();

    } catch (error) {
        console.error("❌ ERROR DETALLADO:", error); 
        if (!res.headersSent) {
            res.status(500).json({ 
                error: "Error interno al procesar la cita.",
                detalle: error.message 
            });
        }
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Richard Barber funcionando en puerto ${PORT}`);
});