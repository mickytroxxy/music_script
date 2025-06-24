import { initializeApp } from "firebase/app";
import { collection, getDocs, doc, setDoc, query, where, updateDoc } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL, uploadBytesResumable } from "firebase/storage";
import { initializeFirestore } from 'firebase/firestore'
import { getAuth} from "firebase/auth";
import fs from 'fs';
const firebaseConfig = {
  apiKey: "AIzaSyC_YPbgewHXM_GtGYyQTI8I4rFQCWOqtn8",
  authDomain: "municipality-b179d.firebaseapp.com",
  projectId: "municipality-b179d",
  storageBucket: "municipality-b179d.appspot.com",
  messagingSenderId: "952540645244",
  appId: "1:952540645244:web:129d4269d2e120d3b246f9"
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, { experimentalForceLongPolling: true })
export const auth = getAuth(app);
export const storage = getStorage(app);


export const createData = async (tableName, docId, data) => {
  try {
    await setDoc(doc(db, tableName, docId), data);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
};

export const updateTable = async (tableName, docId, obj) => {
  try {
    const docRef = doc(db, tableName, docId);
    await updateDoc(docRef, obj);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
};
export const uploadMusic = async (filePath, storagePath, mimeType) => {
  const storage = getStorage(app);
  const fileRef = ref(storage, storagePath);
  const buffer = fs.readFileSync(filePath);
  const metadata = { contentType: mimeType || mime.getType(filePath) || 'audio/mpeg' };
  const uploadTask = await uploadBytesResumable(fileRef, buffer, metadata);
  const url = await getDownloadURL(uploadTask.ref);
  return url;
};

export const getMusicByFingerPrint = async (fingerprint) => {
  try {
    const querySnapshot = await getDocs(query(collection(db, "tracks"), where("fingerprint", "==", fingerprint)));
    const data = querySnapshot.docs.map((doc) => doc.data());
    return data;
  } catch (e) {
    console.error(e);
    return [];
  }
};