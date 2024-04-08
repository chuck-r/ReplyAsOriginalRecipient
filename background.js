// SPDX-License-Identifier: GPL-3.0-only
(function(tb){
'use strict';
const verbose = 1;


const on_compose_start = async (tab, win)=>{
    // HACK: in some scenarios (draft, mailto, auto-bcc), calling
    // getComposeDetails immediately after tab is created causes some
    // message details to be lost, need to sleep to avoid this
    await sleep(10);
    let msg = await tb.compose.getComposeDetails(tab.id);
    log.info('on_compose_start', json2({
        tab: {id: tab.id, win_id: tab.windowId, url: tab.url,
            status: tab.status},
        win: {id: win.id, type: win.type},
        details: msg,
    }));

    // recipients are not always available right away, so need to wait
    if (!is_new(msg))
    {
        let waits = [1, 10, 25, 50, 100, 100, 100, 100]; // total: 486
        for (let i=0; !msg.to.length&&!msg.cc.length && i<waits.length; i++)
        {
            await sleep(waits[i]);
            msg = await tb.compose.getComposeDetails(tab.id);
        }
        log.info('final details', json2(msg));
    }

    let identities = await tb.identities.list();

    if (is_reply(msg))
    {
        let oriMsg = await tb.messages.getFull(msg.relatedMessageId);
        let originalTo;
        if (oriMsg) {
            log.info('orimessage',json2({headers:oriMsg.headers}));
            originalTo = oriMsg.headers['x-original-to']?oriMsg.headers['x-original-to'][0]:null;
        }
        let identityName = splitAddr(msg.from);
        if (!originalTo) {
            if (oriMsg.headers['to'].length==1) {
                let split_recipients = oriMsg.headers['to'][0].split(", ");
                let addr;
                for (addr in split_recipients) {
                    let rcpt = split_recipients[addr];
                    let match_address = splitAddr(rcpt)[1];
                    if (splitAddr(rcpt)[1] == splitAddr(oriMsg.headers['from'][0])[1])
                        continue;

                    let unplussed_addr = splitAddr(rcpt)[1];

                    let delims = [ "+", "-", "@" ];
                    let delim;
                    for (delim in delims) {
                        let obj = delims[delim];
                        if (unplussed_addr.indexOf(obj) < unplussed_addr.lastIndexOf("@")) {
                            unplussed_addr = rcpt.substr(0,rcpt.indexOf(obj));
                            unplussed_addr += rcpt.substr(rcpt.lastIndexOf("@"));
                        }
                        if (unplussed_addr != match_address)
                            break;
                    }
                    if (unplussed_addr != match_address) {
                        let id
                        for (id in identities) {
                            if (identities[id]["email"] == unplussed_addr) {
                                originalTo = identities[id]["name"] + " <" + match_address + ">";
                                break;
                            }
                        }
                    }

                    if (!originalTo)
                    {
                        let match_domain = match_address.substr(match_address.lastIndexOf("@")+1);
                        let matched_identities = [];

                        let id;
                        for (id in identities) {
                            let id_email = identities[id]["email"];

                            if (id_email.substr(id_email.indexOf("@")+1) != match_domain)
                                continue;

                            let test_recipients = split_recipients;
                            let to;
                            for (to in test_recipients) {
                                let test_rcpt = test_recipients[to];
                                if (test_rcpt == match_address)
                                    continue;
                                test_recipients[to] = splitAddr(test_rcpt)[1];
                            }
                            let same_domain = [];
                            for (to in test_recipients) {
                                let test_rcpt = test_recipients[to];
                                if (test_rcpt.substr(test_rcpt.indexOf("@")+1) == match_domain)
                                    same_domain.push(test_rcpt);
                            }
                            if (same_domain.length == 1) {
                                matched_identities.push(identities[id]);
                                break;
                            }
                        }
                        if (matched_identities.length == 1)
                            originalTo = matched_identities[0]["name"] + " <" + match_address + ">";
                    }
                }
            }
        }

        if (originalTo) {
            let splitted = splitAddr(originalTo);
            if (splitted[0]) identityName[0]=splitted[0];
            if (splitted[1]) identityName[1]=splitted[1];
        }
        originalTo = identityName[0]+' <'+identityName[1]+'>';
        await tb.compose.setComposeDetails(tab.id, {from: originalTo});
        msg = await tb.compose.getComposeDetails(tab.id);
    }

    // HACK: editing CC causes focus to move to CC field, which is not useful.
    // Least bad solution is to fix focus manually to body/to.
    for (let delay of [0, 1, 10, 10])
    {
        if (delay) await sleep(delay);
        await set_compose_focus(tab.id, is_reply(msg)&&'body'
            || !msg.to.length&&'to' || 'body', {msg});
    }
};

const set_compose_focus = async (tab_id, target, opt)=>{
    log.info(`setting compose focus to '${target}'`);
    if (target=='to'||target=='cc'||target=='bcc') {
        let msg = opt&&opt.msg;
        if (!msg)
            msg = await tb.compose.getComposeDetails(tab_id);
        let orig_v = msg[target];
        await tb.compose.setComposeDetails(tab_id, {[target]: [...orig_v, 'x']});
        await tb.compose.setComposeDetails(tab_id, {[target]: orig_v});
    } else if (target=='body') {
        await tb.tabs.executeScript(tab_id, {code: 'window.focus()'});
    } else {
        throw new Error('Invalid focus target: '+target);
    }
};

// type field was added in thunderbird 88
// before, we check for "Re: " prefix in subject to detect
const is_reply = msg=>{
    if (msg.type)
        return msg.type=='reply';
    return (msg.subject||'').startsWith('Re: ');
};

const is_new = msg=>{
    if (msg.type)
        return msg.type=='new';
    return !msg.subject;
}

const splitAddr = addr=> {
    var lIoLower = addr.lastIndexOf('<');
    var lIoGreater = addr.lastIndexOf('>');

    var fullName,emailAddr;
    if (lIoLower==-1) {
        if (addr.lastIndexOf('@')!=-1) {
            emailAddr = addr.trim();
        }
    } else if (lIoLower<lIoGreater) {
        emailAddr = addr.substring(lIoLower+1,lIoGreater);
        fullName = addr.substring(0,lIoLower).trim();
    }

    return [fullName,emailAddr];
}


tb.tabs.onCreated.addListener(tab=>{
    log.trace('tabs.onCreated', tab);
    let win = tb.windows.get(tab.windowId);
    if (win && win.type=='messageCompose')
        on_compose_start(tab, win);
});

tb.tabs.onUpdated.addListener((tab_id, changes, tab)=>{
    log.trace('tabs.onUpdated', {tab_id, changes, tab});
});

tb.windows.onCreated.addListener(async win=>{
    if (win.type!='messageCompose')
        return;
    let win_tabs = await tb.tabs.query({windowId: win.id});
    log.trace('win_tabs', win_tabs);
    if (win_tabs.length)
    {
        if (win_tabs.length>1)
            log.warn('compose window has multiple tabs:', tabs);
        on_compose_start(win_tabs[win_tabs.length-1], win);
    }
});

// -- utils --

const sleep = ms=>new Promise(resolve=>setTimeout(()=>resolve(), ms));

const json2 = v=>JSON.stringify(v, null, 2);
const json0 = v=>JSON.stringify(v);

const log = (conf, ...args)=>{
    if (typeof conf=='string')
        conf = {cfn: conf};
    if (conf.verbose && verbose<conf.verbose)
        return;
    console[conf.cfn||'log'](...args);
};
log.error = log.bind(log, {cfn: 'error'});
log.warn = log.bind(log, {cfn: 'warn'});
log.info = log.bind(log, {cfn: 'log', verbose: 1});
log.debug = log.bind(log, {cfn: 'debug', verbose: 2});
log.trace = log.bind(log, {cfn: 'debug', verbose: 3});

})(messenger);
