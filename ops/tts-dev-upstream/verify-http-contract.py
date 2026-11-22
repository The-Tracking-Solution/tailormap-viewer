"""Exercise the compiled health client against the API's actual anonymous-user contract."""
import argparse
from http.server import BaseHTTPRequestHandler,HTTPServer
import json
from pathlib import Path
import subprocess
from threading import Thread

parser=argparse.ArgumentParser();parser.add_argument('--classes',type=Path,required=True);parser.add_argument('--api-source',type=Path,required=True);args=parser.parse_args()
schema=(args.api_source/'src/main/resources/openapi/viewer-api.yaml').read_text()
assert '\n        isAuthenticated:' in schema,'API contract changed'
current={'status':200,'body':{}}
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  assert self.path=='/api/user'
  self.send_response(current['status']);self.end_headers();self.wfile.write(json.dumps(current['body']).encode())
 def log_message(self,*args):pass
server=HTTPServer(('127.0.0.1',18086),Handler);Thread(target=server.serve_forever,daemon=True).start()
try:
 for status,body,accepted in [(200,{'isAuthenticated':False,'roles':[]},True),(200,{'isAuthenticated':True},False),(200,{'authenticated':False},False),(401,{'isAuthenticated':False},False)]:
  current.update(status=status,body=body)
  result=subprocess.run(['java','-cp',str(args.classes),'ProbeHttp','1'],text=True,capture_output=True,timeout=15)
  assert (result.returncode==0)==accepted,(status,body,result.stderr)
  print('PASS',status,json.dumps(body),'accepted='+str(accepted))
finally:server.shutdown();server.server_close()
