import { execSync } from 'child_process';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		lib: {
			entry: resolve(__dirname, 'background.ts'),
			name: 'replyasoriginalrecipient',
			formats: ['es'],
			fileName: () => 'background.js',
		}
	},
	plugins: [
		{
			name: 'postbuild-xpi',
			closeBundle()
			{
				execSync('del /q build\\*');
				execSync('copy /y .\\manifest.json .\\build\\manifest.json');
				execSync('copy /y .\\dist\\background.js .\\build\\background.js');
				execSync('tar -a -c -f .\\replyasoriginalrecipient.zip  --options="zip:compression=deflate" -C build *');
				execSync('copy /y .\\replyasoriginalrecipient.zip .\\build\\replyasoriginalrecipient.xpi');
			}
		}
	]
});