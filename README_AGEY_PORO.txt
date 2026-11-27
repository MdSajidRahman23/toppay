TOPPAY - UPGRADE BUTTON (shudhu copy-paste)
===========================================

ei zip ta UNZIP koro. bhitore 2 ta folder pabe:
   toppay-ext          (extension, notun version 3.18.3, Upgrade button shoho, ready)
   toppay-web-copy     (web er jonno kichu file, ready)


STEP 1 - EXTENSION (tomar PC te)
   a) tomar ager toppay-ext folder er bhitorer sob file muche felo, ba folder ta rename kore rakho (backup).
   b) ei zip er "toppay-ext" folder er bhitorer SOB file tomar toppay-ext folder e COPY-PASTE koro.
   c) Chrome -> chrome://extensions -> TopPay Smart Decision Assistant -> Reload (ghurano tir) chapo.
   (Folder er jaygay ager moto-i thakbe, tai Load unpacked abar korte hobe na.)


STEP 2 - WEB (D:\toppay-web e)
   a) "toppay-web-copy" folder er bhitorer sob (public, tools, .gitattributes, publish-ext.bat)
      COPY kore D:\toppay-web e PASTE koro. "Replace/Merge" boleh "Yes" koro.
      (ager kono file bhangbe na, shudhu notun file/folder jabe)
   b) D:\toppay-web e Command Prompt/Terminal khule ei 3 ta command ek ek kore paste koro:

        git add .
        git commit -m "add extension upgrade"
        git push

   c) 1-2 minute por browser e kholo:  https://toppay-zeta.vercel.app/ext/ext-manifest.json
      jodi likha (JSON) dekha jay, tahole thik ache.


STEP 3 - PROTHOMBAR UPGRADE BUTTON TEST
   extension icon -> "Upgrade extension" -> "Upgrade now".
   Prothombar Chrome folder bachte bolbe: tomar toppay-ext folder ta bachbe. (ekbarei)
   Ekhon "ap-to-date" dekhale sob thik.


PORE KONO UPDATE DILE (extension er code bodlale)
   1) toppay-ext folder e file bodlao, ar manifest.json e "version": "3.18.3" er number ta barao (jemon 3.18.4).
   2) D:\toppay-web e publish-ext.bat e DOUBLE CLICK koro.
      (eta nije extension copy kore git add, commit, push kore dey. toppay-ext folder ta toppay-web er
       pasher folder e thakle nije khuje pay, na hole path jiggesh korbe.)
      Jodi double click kaj na kore, manually:
          python tools\publish_ext.py D:\toppay-ext
          git add .
          git commit -m "ext update"
          git push
   3) user ra extension icon -> Upgrade extension -> Upgrade now.


MONE RAKHO
   - Upgrade page ami real Chrome e chalate parini, tai prothome shudhu nijer PC te test koro.
   - Notun update er file gulo public (Vercel URL jane je kew dekhte pabe).
