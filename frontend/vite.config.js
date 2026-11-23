import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';
// /api -> Spring Boot login service, /fbd-api + /socket.io -> FBD data service. Same origin, so the login session cookie reaches both.
export default defineConfig({plugins:[react()],server:{proxy:{
 '/api':{target:'http://127.0.0.1:8080',changeOrigin:true},
 '/fbd-api':{target:'http://127.0.0.1:3001',changeOrigin:true},
 '/socket.io':{target:'http://127.0.0.1:3001',ws:true,changeOrigin:true}}}})
