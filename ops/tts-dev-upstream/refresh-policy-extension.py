# Bounded overlays for optional map alerts and the confirmed replica-backed JDBC sources.
def layer_alert_updates(source_app, target_app):
    import copy
    source_components=source_app.get('components') or []
    target_components=target_app.get('components') or []
    require(isinstance(source_components,list) and isinstance(target_components,list),'Ongeldige componentlijst.')
    matches=[c for c in target_components if c.get('type')=='layer-alerts']
    require(len(matches)<=1,'Dubbele lokale kaartmeldingencomponent.')
    if not matches:return []
    component=matches[0]
    require(set(component)<= {'type','config'} and isinstance(component.get('config'),dict),'Onbekende kaartmeldingenstructuur.')
    config=component['config']
    require(set(config)<= {'enabled','rule','rules'},'Onbekende kaartmeldingsinstellingen; refresh gestopt.')
    rules=config.get('rules')
    if rules is None:rules=[]
    require(isinstance(rules,list),'Ongeldige kaartmeldingsregels.')
    if config.get('rule') is not None:rules=[*rules,config['rule']]
    allowed={'id','enabled','name','layerId','idAttribute','labelAttribute','mode','bufferKm','statusAttribute','from','to'}
    def nodes(app):
        result={}
        for _,items in paths(app.get('content_root') or {},'layerNodes'):
            require(isinstance(items,list),'Onverwachte laagstructuur.')
            for n in items:
                if isinstance(n,dict) and 'id' in n:
                    require(n['id'] not in result,'Dubbele applicatielaagidentiteit.')
                    result[n['id']]=n
        return result
    old_nodes,new_nodes=nodes(target_app),nodes(source_app)
    for rule in rules:
        require(isinstance(rule,dict) and set(rule)<=allowed,'Onbekende kaartmeldingsregel.')
        layer=rule.get('layerId')
        if not layer:
            require(rule.get('enabled') is False,'Lege ingeschakelde kaartmeldingsregel.')
            continue
        require(layer in old_nodes and layer in new_nodes and all(old_nodes[layer].get(k)==new_nodes[layer].get(k) for k in ('objectType','serviceId','layerName')),
                'Kaartmeldingslaag ontbreekt of wijkt af in replica: '+target_app['name']+' / '+str(layer))
    existing=[i for i,c in enumerate(source_components) if c.get('type')=='layer-alerts']
    require(len(existing)<=1,'Dubbele kaartmeldingencomponent in replica.')
    if existing:
        index=existing[0]
        if source_components[index].get('config')==config:return []
        path=[str(index),'config'];value=copy.deepcopy(config)
    else:
        path=[str(len(source_components))];value=copy.deepcopy(component)
    return [{'table':'application','id':source_app['id'],'column':'components','path':path,'value':value}]


def replica_port_updates(source,target):
    result=[]
    sources=unique(source.get('feature_sources',[]),'id')
    for old in target.get('feature_sources',[]):
        if str(old.get('port'))!='5433' or old.get('database') not in ('django_db','geodata_fresh'):
            continue
        if str(old.get('protocol','')).upper()!='JDBC' or old.get('host') not in ('localhost','127.0.0.1'):
            continue
        new=sources.get(old['id'])
        require(new is not None and str(new.get('protocol','')).upper()=='JDBC'
                and new.get('host') in ('localhost','127.0.0.1')
                and all(new.get(k)==old.get(k) for k in ('database','schema')),
                'Replica-bronpoort kan niet eenduidig worden behouden.')
        if str(new.get('port'))=='5433':continue
        result.append({'table':'feature_source','id':new['id'],'column':'jdbc_connection','path':['port'],'value':old['port']})
    return result
