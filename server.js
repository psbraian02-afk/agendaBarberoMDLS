const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); 
require('dotenv').config();

// Usamos import dinámico para node-fetch (manteniendo tu lógica actual)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)); 

const app = express();
const PORT = process.env.PORT || 10000;

// --- CONFIGURACIÓN DE CARPETAS ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuración Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 } 
}); 

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- HEALTH CHECK (Para que Render deploye más rápido) ---
app.get('/api/health', (req, res) => res.status(200).send('OK'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- CONFIGURACIÓN GOOGLE CALENDAR ---
const oauth2Client = new google.auth.OAuth2(
    "267546833261-409nh69hngn8j1tbqaps1m2lubo77cfr.apps.googleusercontent.com",
    "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",
    process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
    refresh_token: "1//04Jm-T21-bKv3CgYIARAAGAQSNwF-L9IrM7CztZZNPBdOXcC1BAh73EMJhV84RcVmc_J_5q5rDGaH1HNJVQVktuKs21ZAhT9HNKM"
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// RUTA: Consultar disponibilidad
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
        console.error("❌ Error disponibilidad:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- RUTA PRINCIPAL DE AGENDA ---
app.post('/api/agenda', upload.single('foto'), async (req, res) => {
    console.log("--- NUEVA SOLICITUD RECIBIDA ---");
    
    const { nombre, telefono, fecha, horaInicio, horaFin, zona, googleStart, googleEnd, detalles } = req.body;

    if (!nombre || !googleStart || !googleEnd || googleStart === "undefined") {
        return res.status(400).json({ error: "Faltan datos esenciales (Fecha u Hora)." });
    }

    try {
        const timeMinISO = new Date(googleStart).toISOString();
        const timeMaxISO = new Date(googleEnd).toISOString();

        // Verificación rápida
        const checkEvents = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMinISO,
            timeMax: timeMaxISO,
            singleEvents: true,
        });

        if (checkEvents.data.items && checkEvents.data.items.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: "Lo siento, este horario ya fue reservado." 
            });
        }

        let imageUrl = null;
        if (req.file) {
            const host = req.get('host');
            const protocol = req.protocol; 
            imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
        }

        // Respuesta inmediata al cliente
        res.status(200).json({ 
            success: true, 
            message: "¡Horario reservado!",
            imagenURL: imageUrl
        });

        // Procesamiento asíncrono (No bloqueante)
        setImmediate(async () => {
            const FORMSPARK_ID = "s3W9mo046"; 
            const datosFormspark = {
                _subject: `🔥 Turno Confirmado: ${nombre}`,
                nombre, telefono, fecha,
                horario: `${horaInicio} - ${horaFin}`,
                zona, detalles: detalles || "Sin detalles",
                imagen_url: imageUrl || "Sin imagen",
                _template: "table"
            };

            fetch(`https://submit-form.com/${FORMSPARK_ID}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(datosFormspark)
            }).catch(e => console.error("❌ Error Formspark:", e.message));

            const event = {
                summary: `Barber: ${nombre}`,
                location: `Servicio: ${zona}`, 
                description: `CLIENTE: ${nombre}\nTELÉFONO: ${telefono}\nSERVICIO: ${zona}\nDETALLES: ${detalles || "No especificados"}\nFOTO: ${imageUrl || "No adjunta"}`, 
                start: { dateTime: timeMinISO, timeZone: 'America/Argentina/Buenos_Aires' },
                end: { dateTime: timeMaxISO, timeZone: 'America/Argentina/Buenos_Aires' },
            };

            try {
                await calendar.events.insert({ calendarId: 'primary', requestBody: event });
                console.log("📅 Evento en Calendar OK.");
            } catch (err) {
                console.error("❌ Error Calendar:", err.message);
            }
        });

    } catch (error) {
        console.error("❌ ERROR:", error); 
        if (!res.headersSent) res.status(500).json({ error: "Error interno." });
    }
});

// Ruta auxiliar
app.post('/api/upload-referencia', upload.single('imagen'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: "No se recibió imagen" });
    const host = req.get('host');
    const protocol = req.protocol;
    res.json({
        ok: true,
        url: `${protocol}://${host}/uploads/${req.file.filename}`
    });
});

// --- LANZAMIENTO ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor activo en puerto ${PORT}`);
});