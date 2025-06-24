// Import required modules
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fileUpload from 'express-fileupload';
import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Downloader } from 'ytdl-mp3';
import * as yt from 'youtube-search-without-api-key';
import { createData, getMusicByFingerPrint, uploadMusic } from './firebase.js';
import { artists } from './artist.js';
// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();

// Define port
const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  createParentPath: true,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  },
  abortOnLimit: true,
  useTempFiles: true,
  tempFileDir: './uploads/'
}));
const artistIds = ["100675","72481502","8671236","116337","38","102","4768753","293585"];
// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Simple route for testing
app.get('/', (_req, res) => {
  res.json({ message: 'Welcome to the Audio Fingerprinting Server!' });
});

// API routes
app.get('/api/hello', (_req, res) => {
  res.json({ message: 'Hello, World!' });
});

// Audio fingerprinting endpoint
app.post('/api/fingerprint', async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const audioFile = req.files.audio;

    // Check if the file is an audio file
    const allowedMimeTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp3', 'audio/x-m4a'];
    if (!allowedMimeTypes.includes(audioFile.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Only audio files are allowed.' });
    }

    // Generate a unique filename
    const fileName = `${uuidv4()}${path.extname(audioFile.name)}`;
    const filePath = path.join(uploadsDir, fileName);

    // Move the file to the uploads directory
    await audioFile.mv(filePath);

    // Execute fpcalc to generate the fingerprint
    exec(`fpcalc -json "${filePath}"`, (error, stdout, stderr) => {
      // Clean up the temporary file
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Error deleting file: ${err}`);
      });

      if (error) {
        console.error(`Error executing fpcalc: ${error.message}`);

        // Run diagnostics to help troubleshoot the issue
        const diagnostics = {
          error: 'Failed to generate fingerprint',
          details: error.message,
          command: `fpcalc -json "${filePath}"`,
          errorCode: error.code,
          errorSignal: error.signal,
          path: filePath,
          os: process.platform,
          nodeVersion: process.version
        };

        // Try to get fpcalc version information
        try {
          const fpcalcVersionOutput = execSync('fpcalc -version').toString();
          diagnostics.fpcalcVersion = fpcalcVersionOutput.trim();
        } catch (versionError) {
          diagnostics.fpcalcVersionError = versionError.message;

          // Check if fpcalc is installed
          try {
            const fpcalcPath = execSync('which fpcalc').toString();
            diagnostics.fpcalcPath = fpcalcPath.trim();
          } catch (whichError) {
            diagnostics.fpcalcNotFound = true;
            diagnostics.error = 'Failed to generate fingerprint: fpcalc not found. Please make sure Chromaprint is installed.';
          }
        }

        console.error('Diagnostics:', JSON.stringify(diagnostics, null, 2));
        return res.status(500).json(diagnostics);
      }

      if (stderr) {
        console.error(`fpcalc stderr: ${stderr}`);
      }

      try {
        // Parse the JSON output from fpcalc
        const fingerprintData = JSON.parse(stdout);

        // Hash the fingerprint using CryptoJS
        const originalFingerprint = fingerprintData.fingerprint;

        // Create different hash formats
        const sha256Hash = CryptoJS.SHA256(originalFingerprint).toString();
        const md5Hash = CryptoJS.MD5(originalFingerprint).toString();

        // Create response object with hashed fingerprints
        const responseData = {
          ...fingerprintData,
          originalFingerprint: fingerprintData.fingerprint,
          fingerprint: sha256Hash, // Replace original with SHA-256 hash
        };

        // Return the fingerprint data to the client
        return res.json({
          success: true,
          message: 'Fingerprint generated and hashed successfully',
          data: responseData
        });
      } catch (parseError) {
        console.error(`Error parsing fpcalc output: ${parseError.message}`);
        return res.status(500).json({ error: 'Failed to parse fingerprint data' });
      }
    });
  } catch (error) {
    console.error(`Server error: ${error.message}`);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Refactored to accept a file path and return the fingerprint data
const getAudioFingerPrint = async (filePath) => {
  return new Promise((resolve, reject) => {
    exec(`fpcalc -json "${filePath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing fpcalc: ${error.message}`);
        return reject(error);
      }
      if (stderr) {
        console.error(`fpcalc stderr: ${stderr}`);
      }
      try {
        const fingerprintData = JSON.parse(stdout);
        const originalFingerprint = fingerprintData.fingerprint;
        const sha256Hash = CryptoJS.SHA256(originalFingerprint).toString();
        const md5Hash = CryptoJS.MD5(originalFingerprint).toString();
        const responseData = {
          ...fingerprintData,
          originalFingerprint: fingerprintData.fingerprint,
          fingerprint: sha256Hash, // Replace original with SHA-256 hash
          md5: md5Hash
        };
        resolve(responseData);
      } catch (parseError) {
        console.error(`Error parsing fpcalc output: ${parseError.message}`);
        reject(parseError);
      }
    });
  });
};

let downloaded = new Set(
  fs.existsSync('downloaded.json')
    ? JSON.parse(fs.readFileSync('downloaded.json'))
    : []
);

const saveDownloaded = () => {
  fs.writeFileSync('downloaded.json', JSON.stringify([...downloaded]));
};

const isOfficial = (title) => {
  const officialRegex = /\b(official|video|audio|mv|hq)\b/i;
  const blacklistRegex = /\b(live|cover|tribute|remix|karaoke)\b/i;
  return officialRegex.test(title) && !blacklistRegex.test(title);
};
// Normalize title
const normalizeTitle = (title) => {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, "")  // strip parentheses
    .replace(/\s+/g, " ")
    .trim();
};

// Parse "m:ss" into total seconds
const parseDuration = (durationRaw) => {
  console.log(durationRaw)
  const [min, sec] = durationRaw?.split(":").map(Number);
  return min * 60 + sec;
};

const MAX_DURATION_SECONDS = 12 * 60; // 12 mins
const seen = new Set();
const downloadMp3 = async (videoUrl, videoId) => {
  const outputDir = path.join(__dirname, 'files');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
  const outputFile = path.join(outputDir, `${videoId}.mp3`);
  const downloader = new Downloader({ getTags: true, outputDir });

  try {
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    await downloader.downloadSong(videoUrl,videoId); // response.outputFile is the actual file path
    saveDownloaded();
  } catch (error) {
    console.error('Error downloading:');
  }
};
const searchArtistOrTrack = async (query) => {
  let url = `https://api.deezer.com/search?q=${query}`
  const options = {method: 'GET',url};
    try {
      const response = await axios.request(options);
      console.log(response?.data?.data?.[0])
      return response?.data?.data
    } catch (error) {
      console.error(error);
      return null;
    }
}
const searchYoutube = async (searchQuery) => {
  try {
    const videos = await yt.search(searchQuery);
    const videoIds = videos?.map(item => ({videoId:item?.id?.videoId,title:item?.title,artist:item?.title,duration_raw:item?.duration_raw}));
    return videoIds
  } catch (error) {
    console.log(error)
  }
}

const handleSongDownload = async () => {
  for (let item of artists) {
    const {artist,genres} = item;
    const tracks = await searchArtistOrTrack(artist);
    console.log(`Tracks found for ${artist} = ${tracks?.length}`)
    if(tracks?.length > 0){
      for (let track of tracks) {
        const title = track?.title;
        const coverImageUrl = track?.albumArt?.cover_big || 'https://mrdocs.empiredigitals.org/playIcon.png';
        const art = track?.artist?.name || artist
        if (!title) continue;
        if (downloaded.has(`${artist}-${title}`)) continue;
        const videos = await searchYoutube(`${artist} ${title}`);
        const filteredVideos = videos
          .filter((video) => isOfficial(video.title) && parseDuration(video?.duration_raw) <= MAX_DURATION_SECONDS)
          .filter((video) => {
            const normalized = normalizeTitle(video.title);
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
          });
        for (let video of filteredVideos) {
          if (downloaded.has(`${artist}-${title}`)) break;
          if (isOfficial(video.title)) {
            await downloadMp3(`https://www.youtube.com/watch?v=${video.videoId}`,video?.videoId);
            await saveMusicToFireBase(video.videoId, video.title, art, coverImageUrl, genres);
            break;
          }
        }
      }
    }
  }
};
const saveMusicToFireBase = async(videoId, title, artist, coverImageUrl,genres) => {
  const u = path.join(__dirname, 'files')
  const filePath = u+`/${videoId}.mp3`
  if (fs.existsSync(filePath)) {
    const fingerPrintData = await getAudioFingerPrint(filePath);
    const duration = fingerPrintData?.duration;
    const response = await getMusicByFingerPrint(fingerPrintData?.fingerprint);
    if(response.length === 0){
      const musicId = `music_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const audioUrl = await uploadMusic(filePath, `tracks/${videoId}.mp3`, 'audio/mpeg');
      const musicData = {
        id: musicId,
        title,
        artist,
        active:true,
        genres:genres,
        albumArt: coverImageUrl,
        audioUrl,
        url: audioUrl,
        duration,
        ownerId: '',
        uploadDate: new Date().toISOString(),
        playCount: 0,
        fileName: '',
        currentBid: 0,
        fingerprint: fingerPrintData?.fingerprint,
        titleLowerCase: title.toLowerCase(),
        artistLowerCase: artist.toLowerCase(),
        albumLowerCase: '',
        location: 'South Africa'
      };
      const playListSuccess = await createData('tracks', musicId, {...musicData,ownerId:'',active:true,freePlays:0,premiumPlays:0,creditPlays:0,creditPlaysClaimed:0});
      console.log(playListSuccess, 'Saved ====> ', title)
      try {
        fs.unlinkSync(filePath);
        console.log('Deleted local file:', filePath);
      } catch (err) {
        console.error('Error deleting local file:', err);
      }
    }else{
      console.log('Fingerprint exists');
      try {
        fs.unlinkSync(filePath);
        console.log('Deleted local file:', filePath);
      } catch (err) {
        console.error('Error deleting local file:', err);
      }
    }
  }else{
    console.log('No such file............')
    try {
      fs.unlinkSync(filePath);
      console.log('Deleted local file:', filePath);
    } catch (err) {
      console.error('Error deleting local file:', err);
    }
  }
}
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  handleSongDownload()
  //searchYoutube('Kygo')
  //searchArtistOrTrack('Kygo')
  //saveMusicToFireBase('ww')
  //downloadMp3('https://www.youtube.com/watch?v=yViZn6Z9Wq8','Roudeep','Dancing in the moonlight')
});
