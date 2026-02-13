const { spawn } = require('child_process')
const path = require('path')

/**
 * Memulai bot melalui file alpha.js
 */
function start() {
   // Pastikan alpha.js adalah file utama yang berisi koneksi Baileys kamu
   let args = [path.join(__dirname, 'alpha.js'), ...process.argv.slice(2)]
   
   console.log('--- Memulai Alphabot-Md ---')
   
   let p = spawn(process.argv[0], args, {
         stdio: ['inherit', 'inherit', 'inherit', 'ipc']
      })
      .on('message', data => {
         if (data === 'reset') {
            console.log('Restarting Bot...')
            p.kill()
            // start() akan dipanggil otomatis oleh event 'exit'
         }
      })
      .on('exit', code => {
         console.error('Bot keluar dengan kode:', code)
         // Jika bot keluar (crash atau perintah restart), nyalakan lagi
         if (code !== 0) {
            start()
         }
      })
}

start()