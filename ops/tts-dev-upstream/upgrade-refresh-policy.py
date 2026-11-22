#!/usr/bin/env python3
"""Upgrade only the known installed refresh helper, preserving its private original."""
import hashlib
import os
from pathlib import Path
import tempfile

OLD_SHA='34a8767de57e78122424ac474f8acdb6f6dfa7954d3ec32d0402082eae8eca3a'
NEW_SHA='ad5333953bf3eb44a6876ec5660e7cd7769f4b9a1e80127f06c56460709153c8'
SCRIPT_SHA='907414f520ab0b71f31d7c053cf433c7f4b4cab1706f2ad0e69e7f775c10aa77'
GEODATA_SHA='b65a6a281f201b3c91d0fea86718ea5ce5401b0e3183eba723292f4a8afb230a'
DIRECTORY=Path('/srv/tailormap/scripts')


def require(ok,msg):
    if not ok:raise ValueError(msg)


def sha(data):return hashlib.sha256(data).hexdigest()


def transform(text):
    extension=Path(__file__).with_name('refresh-policy-extension.py').read_text()
    changes=[
      ('Only preserve three known video/refresh paths, never user preferences.', 'Preserve bounded video, refresh, alerts and replica ports; source preferences win.'),
      ('Begrensde video-/refreshoverlay:', 'Begrensde lokale overlay:'),
      ("'feature_sources',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'protocol',protocol,'title',title)), '[]') FROM public.feature_source)",
       "'feature_sources',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'protocol',protocol,'title',title,'host',jdbc_connection->>'host','port',jdbc_connection->'port','database',jdbc_connection->>'database','schema',jdbc_connection->>'schema')), '[]') FROM public.feature_source)"),
      ('def plan(source, target):',extension+'\n\ndef plan(source, target):'),
      ("        if not wanted:\n            continue", "        updates.extend(layer_alert_updates(new,old))\n        if not wanted:\n            continue"),
      ('    return updates\n', '    updates.extend(replica_port_updates(source,target))\n    return updates\n'),
      ("source_sources[origin] == target_sources.get(origin)", "all(source_sources[origin].get(k)==(target_sources.get(origin) or {}).get(k) for k in ('id','protocol','title'))"),
      ("item['table'] in ('application', 'feature_type') and\n                item['column'] in ('settings','components')", "((item['table']=='application' and item['column'] in ('settings','components')) or\n                 (item['table']=='feature_type' and item['column']=='settings') or\n                 (item['table']=='feature_source' and item['column']=='jdbc_connection' and item['path']==['port'] and str(item['value'])=='5433'))"),
      ('        path = item[\'path\']\n', "        path = item['path']\n        if column=='components':\n            statements.append(f\"UPDATE public.{table} SET components=coalesce(components,'[]'::jsonb) WHERE id={item['id']};\")\n")
    ]
    for before,after in changes:
        require(text.count(before)==1,'Refresh-bron wijkt af bij een patchpunt')
        text=text.replace(before,after,1)
    compile(text,'refresh-policy.py','exec')
    return text


def atomic_write(path,data,mode):
    fd,name=tempfile.mkstemp(prefix='.upstream-policy-',dir=path.parent)
    temp=Path(name)
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        temp.chmod(mode);os.replace(temp,path)
    finally:temp.unlink(missing_ok=True)


def install(backup):
    for name,expected in [('refresh-lt3-data.sh',SCRIPT_SHA),('refresh-geodata.py',GEODATA_SHA)]:
        require((DIRECTORY/name).is_file() and sha((DIRECTORY/name).read_bytes())==expected,'Onbekende geïnstalleerde refreshversie: '+name)
    path=DIRECTORY/'refresh-policy.py';require(path.is_file() and not path.is_symlink(),'Onverwachte refresh-helper')
    current=path.read_bytes()
    if sha(current)==NEW_SHA:return 'ALREADY_CURRENT'
    require(sha(current)==OLD_SHA,'Geïnstalleerde refresh-policy is gewijzigd; niet overschreven')
    updated=transform(current.decode()).encode();require(sha(updated)==NEW_SHA,'Nieuwe refresh-policy checksum wijkt af')
    backup.mkdir(parents=True,exist_ok=True)
    (backup/'refresh-policy.before').write_bytes(current)
    atomic_write(path,updated,path.stat().st_mode & 0o777)
    return 'UPDATED'
