const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); 
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

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
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// NUEVA RUTA: Consultar disponibilidad real (Mantenida según lo pedido)
app.get('/api/disponibilidad', async (req, res) => {
    const { start, end } = req.query; 
    try {
        oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
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
    // 1. Verificamos qué llega exactamente
    console.log("--- NUEVA SOLICITUD RECIBIDA ---");
    console.log("Body:", req.body); 

    const { nombre, telefono, fecha, horaInicio, horaFin, zona, googleStart, googleEnd } = req.body;

    // VALIDACIÓN PREVIA PARA EVITAR EL CRASH
    if (!nombre || !googleStart || !googleEnd || googleStart === "undefined") {
        console.error("❌ Error: Faltan datos o vienen mal formateados desde el cliente.");
        return res.status(400).json({ error: "Faltan datos esenciales (Fecha u Hora)." });
    }

    try {
        // Configuramos credenciales
        oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

        // 2. Intentamos listar eventos
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

        // 3. Si llega aquí, está libre. Respondemos OK al cliente DE INMEDIATO.
        res.status(200).json({ success: true, message: "¡Horario reservado!" });

        // --- SEGUNDO PLANO (Ejecución asíncrona para no demorar la respuesta) ---
        
        // Función interna para procesar tareas pesadas sin bloquear
        const procesarSegundoPlano = async () => {
            // Enviar a Formspark
            const datosFormspark = {
                _subject: `🔥 Turno Confirmado: ${nombre}`,
                nombre, telefono, fecha, horario: `${horaInicio} - ${horaFin}`, zona
            };

            fetch("https://submit-form.com/2Rt2nPef4", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(datosFormspark)
            }).catch(e => console.error("Error Formspark:", e.message));

            // Crear evento en Google
            const event = {
                summary: `Tattoo: ${nombre}`,
                description: `Tel: ${telefono} | Zona: ${zona}`,
                start: { dateTime: timeMinISO, timeZone: 'America/Argentina/Buenos_Aires' },
                end: { dateTime: timeMaxISO, timeZone: 'America/Argentina/Buenos_Aires' },
            };

            try {
                await calendar.events.insert({ calendarId: 'primary', resource: event });
                console.log("📅 Evento creado exitosamente.");
            } catch (err) {
                console.error("❌ Error al insertar en Calendar:", err.message);
            }
        };

        // Disparamos las tareas de segundo plano sin el "await" para que la web no se quede cargando
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
    console.log(`🚀 Servidor RichardTattoo funcionando en puerto ${PORT}`);
});