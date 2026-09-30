import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins:[react()], server:{host:'localhost',port:5182,strictPort:true,hmr:false,proxy:{'/api':{target:'http://localhost:6182',changeOrigin:true}}} });
