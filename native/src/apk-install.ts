import {extname,isAbsolute,basename} from 'node:path';
import {open} from 'node:fs/promises';
import {Adb} from './adb';

export async function validateApk(path:unknown):Promise<string> {
  if(typeof path!=='string'||!isAbsolute(path)||extname(path).toLowerCase()!=='.apk'||path.includes('\0'))throw Error('Escolha um arquivo APK local.');
  const file=await open(path,'r');
  try {
    const stat=await file.stat();
    if(!stat.isFile()||stat.size<4||stat.size>2*1024*1024*1024)throw Error('Tamanho de APK inválido.');
    const header=Buffer.alloc(4);await file.read(header,0,4,0);
    if(header.readUInt32LE()!==0x04034b50)throw Error('O arquivo não é um pacote APK.');
  } finally {await file.close();}
  return path;
}

/** One install per device; shell-free arguments preserve spaces and metacharacters. */
export class ApkInstaller {
  private busy=new Set<string>();
  constructor(private adb:Adb){}
  async install(serial:string,input:unknown):Promise<string>{
    if(this.busy.has(serial))throw Error('Aguarde a instalação atual terminar.');
    this.busy.add(serial);
    try {
      const path=await validateApk(input);
      const output=await this.adb.device(serial,['install','-r',path],120000);
      if(!/(^|\r?\n)Success\s*$/.test(output))throw Error('Android não confirmou a instalação: '+output.slice(-500));
      return basename(path);
    } finally {this.busy.delete(serial);}
  }
}
