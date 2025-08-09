import { google } from 'googleapis';
import fs from 'fs';
import fetch from 'node-fetch';
import { ConfigurationError } from './utils/errors.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata'
];

const credsPath = './creds/service-account.json';
let auth = null;
let driveService = null;
let imagesFolderId = null;

/**
 * Initialize Google Drive auth (reuses same service account as Sheets)
 */
function initializeDriveAuth() {
  if (auth && driveService) return;

  try {
    const credentials = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [...SCOPES, 'https://www.googleapis.com/auth/spreadsheets'],
    });
    
    driveService = google.drive({ version: 'v3', auth });
    console.log('✅ Google Drive API initialized');
  } catch (error) {
    throw new ConfigurationError(`Failed to initialize Google Drive Auth: ${error.message}`);
  }
}

/**
 * Get or create the Images folder in Google Drive
 */
async function getOrCreateImagesFolder() {
  if (imagesFolderId) return imagesFolderId;
  
  try {
    initializeDriveAuth();
    
    // Search for existing Images folder
    const searchResponse = await driveService.files.list({
      q: "name='Images' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      spaces: 'drive',
      fields: 'files(id, name)',
    });
    
    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      imagesFolderId = searchResponse.data.files[0].id;
      console.log(`📁 Using existing Images folder: ${imagesFolderId}`);
      return imagesFolderId;
    }
    
    // Create new Images folder if it doesn't exist
    const fileMetadata = {
      name: 'Images',
      mimeType: 'application/vnd.google-apps.folder',
    };
    
    const folder = await driveService.files.create({
      resource: fileMetadata,
      fields: 'id',
    });
    
    imagesFolderId = folder.data.id;
    console.log(`📁 Created new Images folder: ${imagesFolderId}`);
    
    // Make folder accessible to anyone with link
    await driveService.permissions.create({
      fileId: imagesFolderId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
    
    return imagesFolderId;
  } catch (error) {
    console.error('❌ Failed to get/create Images folder:', error.message);
    throw error;
  }
}

/**
 * Download image from WhatsApp/Meta URL
 */
async function downloadImage(imageUrl, accessToken = null) {
  try {
    const headers = {};
    
    // Add authorization if we have a Meta access token
    if (accessToken || process.env.META_ACCESS_TOKEN) {
      headers['Authorization'] = `Bearer ${accessToken || process.env.META_ACCESS_TOKEN}`;
    }
    
    console.log(`⬇️ Downloading image from: ${imageUrl}`);
    const response = await fetch(imageUrl, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    
    const buffer = await response.buffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    console.log(`✅ Downloaded image (${buffer.length} bytes, type: ${contentType})`);
    return { buffer, contentType };
  } catch (error) {
    console.error('❌ Failed to download image:', error.message);
    throw error;
  }
}

/**
 * Upload image to Google Drive and return shareable link
 */
export async function uploadImageToDrive(imageUrl, metadata = {}) {
  try {
    initializeDriveAuth();
    
    // Get or create Images folder
    const folderId = await getOrCreateImagesFolder();
    
    // Download the image from WhatsApp
    const { buffer, contentType } = await downloadImage(imageUrl);
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = contentType.split('/')[1] || 'jpg';
    const filename = `complaint_${metadata.sender || 'unknown'}_${timestamp}.${extension}`;
    
    // Upload to Google Drive
    const fileMetadata = {
      name: filename,
      parents: [folderId],
      description: `WhatsApp complaint image from ${metadata.sender || 'unknown'} at ${metadata.timestamp || timestamp}`,
    };
    
    const media = {
      mimeType: contentType,
      body: buffer,
    };
    
    console.log(`📤 Uploading image to Drive: ${filename}`);
    
    const file = await driveService.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink',
    });
    
    // Make file accessible to anyone with link
    await driveService.permissions.create({
      fileId: file.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
    
    // Get shareable link
    const shareableLink = `https://drive.google.com/file/d/${file.data.id}/view?usp=sharing`;
    
    console.log(`✅ Image uploaded to Drive: ${shareableLink}`);
    
    return {
      driveId: file.data.id,
      shareableLink,
      webViewLink: file.data.webViewLink,
      filename,
    };
  } catch (error) {
    console.error('❌ Failed to upload image to Drive:', error.message);
    // Return null instead of throwing to not break the flow
    return null;
  }
}

/**
 * Delete an image from Google Drive
 */
export async function deleteImageFromDrive(fileId) {
  try {
    initializeDriveAuth();
    
    await driveService.files.delete({
      fileId: fileId,
    });
    
    console.log(`🗑️ Deleted image from Drive: ${fileId}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to delete image from Drive:', error.message);
    return false;
  }
}

export default {
  uploadImageToDrive,
  deleteImageFromDrive,
};