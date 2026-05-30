-- Add video_url to exercises so the client can attach a reference video (YouTube/Vimeo/etc).
ALTER TABLE exercises ADD COLUMN video_url TEXT;
