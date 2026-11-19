// Page language and club branding.
//
// The site is written in English. When the club's config (js/club.js) says LANG: 'fr', this file
// shows every piece of wording in French: the static page text, and the messages the scripts add
// later (it watches the page and translates new text as it appears). Wording it does not know stays
// in English, so a missing translation never breaks anything.
//
// To add or change a French wording: edit FR (exact sentences) or PATTERNS (sentences with a name or
// number inside) below. Text inside an element marked data-no-i18n (names, bios) is never translated.
(function () {
  'use strict';

  var club = window.NINES_CLUB || { CLUB_ID: 1, NAME: 'The Nines', LANG: 'en' };
  var lang = club.LANG === 'fr' ? 'fr' : 'en';
  document.documentElement.lang = lang;

  // ---- Exact wordings (the English text, spaces collapsed) -> French ----
  var FR = {
    // top bar, common
    'Skip to content': 'Aller au contenu',
    'Home': 'Accueil',
    'Directory': 'Annuaire',
    'Map': 'Carte',
    'Admin': 'Admin',
    'Sign out': 'Se déconnecter',
    'Menu': 'Menu',
    '(opens in a new tab)': '(s’ouvre dans un nouvel onglet)',
    'Club': 'Club',
    'Try again': 'Réessayer',
    'Something went wrong': 'Un problème est survenu',
    'This page needs JavaScript.': 'Cette page a besoin de JavaScript.',
    'This page needs JavaScript to sign you in.': 'Cette page a besoin de JavaScript pour vous connecter.',
    'Not on the member list': 'Absent de la liste des membres',
    'Your email is not on the member list. Please contact the office.': 'Votre e-mail ne figure pas sur la liste des membres. Merci de contacter le bureau.',
    'Signed in as': 'Connecté en tant que',
    'Checking your membership…': 'Vérification de votre adhésion…',
    'Checking your access…': 'Vérification de votre accès…',
    'Checking your login…': 'Vérification de votre connexion…',
    'Loading…': 'Chargement…',
    'Admins only': 'Réservé aux admins',
    'This page is for club admins.': 'Cette page est réservée aux admins du club.',
    'Go to the member home': 'Aller à l’accueil membres',
    'Member area': 'Espace membres',
    'Member login': 'Connexion membres',
    'See the map': 'Voir la carte',

    // login
    'Sign in with Google': 'Se connecter avec Google',
    'or': 'ou',
    'Email and password': 'E-mail et mot de passe',
    'Choose what to do': 'Choisissez une action',
    'Sign in': 'Se connecter',
    'Create account': 'Créer un compte',
    'Email': 'E-mail',
    'Password': 'Mot de passe',
    'At least 8 characters.': 'Au moins 8 caractères.',
    'Forgot password?': 'Mot de passe oublié ?',
    'Email me a sign-in link': 'Recevoir un lien de connexion par e-mail',
    'No password needed. We\'ll send a link that signs you in.': 'Pas besoin de mot de passe : nous vous envoyons un lien qui vous connecte.',
    'Send sign-in link': 'Envoyer le lien',
    'Choose a new password': 'Choisissez un nouveau mot de passe',
    'New password': 'Nouveau mot de passe',
    'Type it again': 'Saisissez-le à nouveau',
    'Save new password': 'Enregistrer le mot de passe',
    'Reload the login page': 'Recharger la page de connexion',
    'Back to the home page': 'Retour à l’accueil',
    'Signing in…': 'Connexion…',
    'Creating…': 'Création…',
    'Sending…': 'Envoi…',
    'Saving…': 'Enregistrement…',
    'Please enter a valid email address.': 'Merci de saisir une adresse e-mail valide.',
    'Please enter your password.': 'Merci de saisir votre mot de passe.',
    'Please choose a password of at least 8 characters.': 'Merci de choisir un mot de passe d’au moins 8 caractères.',
    'The two passwords do not match.': 'Les deux mots de passe ne correspondent pas.',
    'Password saved. Taking you to the member area…': 'Mot de passe enregistré. Direction l’espace membres…',
    'Type your email address above first, then press "Forgot password?" again.': 'Saisissez d’abord votre adresse e-mail ci-dessus, puis cliquez à nouveau sur « Mot de passe oublié ? ».',
    'That password reset link has expired or was already used. Please ask for a new one.': 'Ce lien de réinitialisation a expiré ou a déjà servi. Merci d’en demander un nouveau.',
    'The login system could not load. Check your connection, turn off any content blocker for this site, and reload.': 'Le système de connexion n’a pas pu se charger. Vérifiez votre connexion, désactivez tout bloqueur de contenu pour ce site, puis rechargez.',
    'Could not reach the server. Check your connection and try again.': 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
    'Too many attempts. Please wait a few minutes and try again.': 'Trop de tentatives. Patientez quelques minutes puis réessayez.',
    'That email and password do not match. Check them, or use "Forgot password".': 'Cet e-mail et ce mot de passe ne correspondent pas. Vérifiez-les ou utilisez « Mot de passe oublié ».',
    'Please confirm your email first: open the link we sent you when you created your account.': 'Confirmez d’abord votre e-mail : ouvrez le lien envoyé lors de la création de votre compte.',
    'That link has expired or was already used. Please ask for a new one.': 'Ce lien a expiré ou a déjà servi. Merci d’en demander un nouveau.',
    'Something went wrong. Please try again.': 'Un problème est survenu. Merci de réessayer.',
    'Your session has ended. Please sign in again.': 'Votre session a expiré. Merci de vous reconnecter.',

    // member home
    'Welcome,': 'Bienvenue,',
    'Member': 'Membre',
    'Complete your profile': 'Complétez votre profil',
    'Add a photo and a few words about yourself so other members can find you in the directory. Your email and phone stay hidden unless you choose to show them.': 'Ajoutez une photo et quelques mots sur vous pour que les autres membres vous trouvent dans l’annuaire. Votre e-mail et votre téléphone restent masqués, sauf si vous choisissez de les afficher.',
    'Fill in my profile': 'Compléter mon profil',
    'Member directory': 'Annuaire des membres',
    'Edit my profile': 'Modifier mon profil',
    'Manage the member list': 'Gérer la liste des membres',
    'More is coming here soon.': 'D’autres choses arrivent bientôt ici.',

    // directory
    'Search by name': 'Rechercher par nom',
    'Loading the directory…': 'Chargement de l’annuaire…',
    'No members are listed yet.': 'Aucun membre n’est encore listé.',
    'No members match that name.': 'Aucun membre ne correspond à ce nom.',
    'Photos are private to members. Email and phone appear only for members who chose to show them; the club\'s admins see them all.': 'Les photos sont réservées aux membres. L’e-mail et le téléphone n’apparaissent que pour les membres qui ont choisi de les afficher ; les admins du club les voient tous.',
    'Former member': 'Ancien membre',
    'Foreign member': 'Membre à l’étranger',

    // profile
    'My profile': 'Mon profil',
    'Back to the directory': 'Retour à l’annuaire',
    'Back to admin': 'Retour à l’admin',
    'This is what other members see in the directory. Your bio is for members only.': 'Voici ce que les autres membres voient dans l’annuaire. Votre bio est réservée aux membres.',
    'Display name': 'Nom affiché',
    '(required)': '(obligatoire)',
    '(optional)': '(facultatif)',
    'Short bio': 'Courte bio',
    'Phone': 'Téléphone',
    'Digits, spaces and + ( ) - . only, for example +44 7700 900123.': 'Chiffres, espaces et + ( ) - . uniquement, par exemple +33 6 12 34 56 78.',
    'Headshot': 'Photo',
    'Choose a photo': 'Choisir une photo',
    'Remove photo': 'Retirer la photo',
    'This club shows a photo of its own. A new photo replaces your main photo, used in your other clubs, and this one.': 'Ce club affiche une photo qui lui est propre. Une nouvelle photo remplace votre photo principale, utilisée dans vos autres clubs, ainsi que celle-ci.',
    'JPEG, PNG or similar, up to 5 MB. It is cropped to a square and resized before upload, and camera details such as location are removed.': 'JPEG, PNG ou similaire, jusqu’à 5 Mo. Elle est recadrée en carré et réduite avant l’envoi ; les données de l’appareil, comme la localisation, sont supprimées.',
    'What other members can see': 'Ce que les autres membres peuvent voir',
    'Show my email to other members': 'Afficher mon e-mail aux autres membres',
    'Show my phone number to other members': 'Afficher mon téléphone aux autres membres',
    'Show email to other members': 'Afficher l’e-mail aux autres membres',
    'Show phone number to other members': 'Afficher le téléphone aux autres membres',
    'Admin settings': 'Réglages admin',
    'Listed in the directory': 'Visible dans l’annuaire',
    '(untick to hide this card; it does not change access)': '(décocher pour masquer cette fiche ; l’accès ne change pas)',
    '(moved abroad: shown with a label, and left out of club emails)': '(parti à l’étranger : affiché avec une mention et exclu des e-mails du club)',
    'Save profile': 'Enregistrer le profil',
    'Preview': 'Aperçu',
    'How this card looks to other members.': 'Comment les autres membres voient cette fiche.',
    'Your name': 'Votre nom',
    'Headshot preview': 'Aperçu de la photo',
    'Hidden: this card is not shown in the directory.': 'Masquée : cette fiche n’apparaît pas dans l’annuaire.',
    'Photo ready. Press "Save profile" to upload it.': 'Photo prête. Cliquez sur « Enregistrer le profil » pour l’envoyer.',
    'Photo will be removed when you press "Save profile".': 'La photo sera retirée quand vous cliquerez sur « Enregistrer le profil ».',
    'Your profile is saved.': 'Votre profil est enregistré.',
    'Profile saved.': 'Profil enregistré.',
    'Please enter a display name.': 'Merci de saisir un nom affiché.',
    'Please keep the display name to 80 characters or fewer.': 'Le nom affiché ne doit pas dépasser 80 caractères.',
    'Please keep the bio to 500 characters or fewer.': 'La bio ne doit pas dépasser 500 caractères.',
    'That phone number has characters we cannot use. Use digits, spaces and + ( ) - . only.': 'Ce numéro contient des caractères non acceptés. Utilisez uniquement des chiffres, des espaces et + ( ) - .',
    'That phone number has characters we cannot use.': 'Ce numéro contient des caractères non acceptés.',
    'Add a phone number, or untick the "show phone number" box.': 'Ajoutez un numéro, ou décochez la case « afficher le téléphone ».',
    'You do not have permission to change this profile.': 'Vous n’avez pas le droit de modifier ce profil.',
    'Please enter a display name of 1 to 80 characters.': 'Merci de saisir un nom affiché de 1 à 80 caractères.',
    'That photo is too large. Please try another one.': 'Cette photo est trop lourde. Merci d’en essayer une autre.',
    'That photo could not be used.': 'Cette photo n’a pas pu être utilisée.',
    'That file is not an image. Please choose a JPEG, PNG or similar photo.': 'Ce fichier n’est pas une image. Choisissez une photo JPEG, PNG ou similaire.',
    'That photo is larger than 5 MB. Please choose a smaller one.': 'Cette photo dépasse 5 Mo. Choisissez-en une plus légère.',
    'That image could not be read. Please try another photo.': 'Cette image n’a pas pu être lue. Essayez une autre photo.',
    'That image could not be processed. Please try another photo.': 'Cette image n’a pas pu être traitée. Essayez une autre photo.',
    'That image could not be opened. Please try a JPEG or PNG photo.': 'Cette image n’a pas pu être ouverte. Essayez une photo JPEG ou PNG.',
    'Please choose a photo.': 'Merci de choisir une photo.',
    'The profile could not be saved. Please reload and try again.': 'Le profil n’a pas pu être enregistré. Rechargez la page et réessayez.',
    'The card could not be saved. Please reload and try again.': 'La fiche n’a pas pu être enregistrée. Rechargez la page et réessayez.',
    'Welcome! Check your profile and press "Save profile". Email and phone stay hidden unless you tick the boxes.': 'Bienvenue ! Vérifiez votre profil et cliquez sur « Enregistrer le profil ». L’e-mail et le téléphone restent masqués sauf si vous cochez les cases.',
    'You are editing this profile as an admin. Changes show in the directory straight away.': 'Vous modifiez ce profil en tant qu’admin. Les changements apparaissent tout de suite dans l’annuaire.',
    'Only club admins can edit another member\'s profile.': 'Seuls les admins du club peuvent modifier le profil d’un autre membre.',
    'Edit my own profile': 'Modifier mon propre profil',
    'Member not found': 'Membre introuvable',
    'That member has not logged in yet, or is no longer on the list.': 'Ce membre ne s’est pas encore connecté, ou ne figure plus sur la liste.',
    'No directory card': 'Pas de fiche dans l’annuaire',
    'This account (': 'Ce compte (',
    ') is set up as an office or staff account, so it has no card in the directory. It can still use everything else in the member area.': ') est un compte du bureau ou du personnel : il n’a pas de fiche dans l’annuaire, mais peut utiliser tout le reste de l’espace membres.',
    'If it should have a card, an admin can create one from the admin page.': 'S’il doit avoir une fiche, un admin peut la créer depuis la page admin.',
    'Go to the directory': 'Aller à l’annuaire',

    // admin
    'Members of': 'Membres du club',
    '. Access (who can sign in) and directory cards (what members see) are managed separately below, for this club only.': '. L’accès (qui peut se connecter) et les fiches de l’annuaire (ce que voient les membres) se gèrent séparément ci-dessous, pour ce club uniquement.',
    'Super admins': 'Super admins',
    'Admins of every club. Only you and other super admins see this list; it is changed in the Supabase SQL editor (see the README).': 'Admins de tous les clubs. Seuls vous et les autres super admins voyez cette liste ; elle se modifie dans l’éditeur SQL de Supabase (voir le README).',
    'Add a member': 'Ajouter un membre',
    'Role': 'Rôle',
    '(office or staff account: access only)': '(compte du bureau ou du personnel : accès seul)',
    'Add member': 'Ajouter',
    'Gives access and creates their directory card together. If the email already has a card (for example someone whose access was removed), access is restored and the card is kept.': 'Donne l’accès et crée la fiche en une fois. Si l’e-mail a déjà une fiche (par exemple quelqu’un dont l’accès a été retiré), l’accès est rétabli et la fiche conservée.',
    'Access': 'Accès',
    'Only these emails can sign in and see the member area.': 'Seuls ces e-mails peuvent se connecter et voir l’espace membres.',
    'Added by': 'Ajouté par',
    'Added on': 'Ajouté le',
    'Card': 'Fiche',
    'Actions': 'Actions',
    'Directory cards': 'Fiches de l’annuaire',
    'Every profile, including people without access. Only listed cards appear in the directory.': 'Tous les profils, y compris les personnes sans accès. Seules les fiches visibles apparaissent dans l’annuaire.',
    'No cards yet.': 'Aucune fiche pour l’instant.',
    'Name': 'Nom',
    'Signed in': 'Connecté',
    'Listed': 'Visible',
    'Hidden': 'Masquée',
    'No access': 'Pas d’accès',
    'Not yet': 'Pas encore',
    'Yes': 'Oui',
    'Edit': 'Modifier',
    'Hide': 'Masquer',
    'Show': 'Afficher',
    'Remove': 'Retirer',
    'Remove from club': 'Retirer du club',
    'Change email': 'Changer l’e-mail',
    'Create card': 'Créer une fiche',
    'No card': 'Pas de fiche',
    'No card (office/staff)': 'Pas de fiche (bureau/personnel)',
    'Brigadier groups': 'Groupes de brigadiers',
    'The standing teams that organise the dinners, usually two people, rarely three. Co-brigadiers shown on directory cards come from these groups.': 'Les équipes qui organisent les dîners, en général deux personnes, parfois trois. Les co-brigadiers affichés sur les fiches viennent de ces groupes.',
    'No brigadier groups yet.': 'Aucun groupe de brigadiers pour l’instant.',
    'New brigadier group': 'Nouveau groupe de brigadiers',
    'Member 1': 'Membre 1',
    'Member 2': 'Membre 2',
    'Member 3': 'Membre 3',
    'Choose a member': 'Choisir un membre',
    'No third member': 'Pas de troisième membre',
    'Create group': 'Créer le groupe',
    'Save group': 'Enregistrer le groupe',
    'Cancel editing': 'Annuler la modification',
    'Delete': 'Supprimer',
    'Remove access?': 'Retirer l’accès ?',
    'will no longer be able to sign in to the member area. Their directory card is kept.': 'ne pourra plus se connecter à l’espace membres. Sa fiche dans l’annuaire est conservée.',
    'Also hide their card from the directory': 'Masquer aussi sa fiche dans l’annuaire',
    'Remove access': 'Retirer l’accès',
    'Cancel': 'Annuler',
    'Remove from': 'Retirer du club',
    'This deletes': 'Cela supprime, pour',
    '\'s access, card and brigadier group places in': ', l’accès, la fiche et les places dans les groupes de brigadiers du club',
    '. It cannot be undone. Other clubs are not changed.': '. C’est définitif. Les autres clubs ne sont pas modifiés.',
    'They are in no other club, so their profile, photo and sign-in record are deleted as well.': 'Cette personne n’est dans aucun autre club : son profil, sa photo et son compte de connexion sont aussi supprimés.',
    'They stay in their other club(s), with their profile and photo.': 'Cette personne reste dans ses autres clubs, avec son profil et sa photo.',
    'Delete this brigadier group?': 'Supprimer ce groupe de brigadiers ?',
    'Group': 'Le groupe',
    'will be deleted. The members\' cards are not changed.': 'sera supprimé. Les fiches des membres ne changent pas.',
    'Delete group': 'Supprimer le groupe',
    'Move': 'Déplacer',
    'to a new address. Their access, card, photo, bio and brigadier group move with it. They then sign in with the new email.': 'vers une nouvelle adresse. Son accès, sa fiche, sa photo, sa bio et son groupe de brigadiers suivent. La personne se connecte ensuite avec le nouvel e-mail.',
    'New email': 'Nouvel e-mail',
    '(you)': '(vous)',
    'You cannot remove yourself.': 'Vous ne pouvez pas vous retirer vous-même.',
    'You cannot remove yourself. Ask another admin.': 'Vous ne pouvez pas vous retirer vous-même. Demandez à un autre admin.',
    'The last admin cannot be removed.': 'Le dernier admin ne peut pas être retiré.',
    'Ask another admin to change your own email.': 'Demandez à un autre admin de changer votre e-mail.',
    'You cannot change your own email here. Ask another admin.': 'Vous ne pouvez pas changer votre propre e-mail ici. Demandez à un autre admin.',
    'Please enter a valid email address, like name@example.com.': 'Merci de saisir une adresse e-mail valide, comme nom@exemple.fr.',
    'That is the same email.': 'C’est le même e-mail.',
    'That email is already used by someone else.': 'Cet e-mail est déjà utilisé par quelqu’un d’autre.',
    'The new email is already used by someone else.': 'Le nouvel e-mail est déjà utilisé par quelqu’un d’autre.',
    'That email already exists.': 'Cet e-mail existe déjà.',
    'That email address does not look right.': 'Cette adresse e-mail ne semble pas correcte.',
    'You do not have permission to do that. Only admins can change members.': 'Vous n’avez pas le droit de faire cela. Seuls les admins peuvent modifier les membres.',
    'Choose at least two members for a brigadier group.': 'Choisissez au moins deux membres pour un groupe de brigadiers.',
    'The same person is chosen twice.': 'La même personne est choisie deux fois.',
    'This group has more than three members. Saving here keeps only the three shown.': 'Ce groupe compte plus de trois membres. Enregistrer ici ne garde que les trois affichés.',
    'Please reload and try again.': 'Rechargez la page et réessayez.',
    'Nothing was deleted. Please reload and try again.': 'Rien n’a été supprimé. Rechargez la page et réessayez.',
    '(no members)': '(aucun membre)',
    'Deleted card': 'Fiche supprimée',
    'a member': 'membre',
    'an admin': 'admin',

    // Recos
    'Recos: restaurants members recommend': 'Recos : les restaurants recommandés par les membres',
    'Add a reco': 'Ajouter une reco',
    'Restaurants members recommend. Separate from the club\'s dinner map.': 'Les restaurants recommandés par les membres. Distinct de la carte des dîners du club.',
    'Find the restaurant': 'Trouver le restaurant',
    'Type its name, or paste a Google Maps link.': 'Tapez son nom, ou collez un lien Google Maps.',
    'Address': 'Adresse',
    'Drag the pin if it is not exactly on the restaurant.': 'Déplacez l’épingle si elle n’est pas exactement sur le restaurant.',
    'Location of the restaurant: drag the pin to correct it': 'Emplacement du restaurant : déplacez l’épingle pour le corriger',
    'Drag to correct the location': 'Déplacez pour corriger l’emplacement',
    'Restaurant location': 'Emplacement du restaurant',
    'Your reco': 'Votre reco',
    'Who can see it': 'Qui peut la voir',
    'Everyone': 'Tout le monde',
    'My club': 'Mon club',
    'Only me': 'Moi seulement',
    'Everyone: members of every club can see it.': 'Tout le monde : les membres de tous les clubs peuvent la voir.',
    'My club: only members of the club you post as can see it.': 'Mon club : seuls les membres du club au nom duquel vous publiez peuvent la voir.',
    'Only me: nobody else can see it.': 'Moi seulement : personne d’autre ne peut la voir.',
    'Post as': 'Publier au nom de',
    'Already recommended': 'Déjà recommandé',
    'Your reco will be added to this restaurant.': 'Votre reco sera ajoutée à ce restaurant.',
    'Add my reco': 'Ajouter ma reco',
    'Add my reco to it': 'Ajouter ma reco à ce restaurant',
    'Filter by name': 'Filtrer par nom',
    'Map of recommended restaurants': 'Carte des restaurants recommandés',
    'No recos yet. Be the first to add one.': 'Aucune reco pour l’instant. Soyez le premier à en ajouter une.',
    'No recos you can see.': 'Aucune reco visible pour vous.',
    'Edit your reco': 'Modifier votre reco',
    'Save': 'Enregistrer',
    'Delete this reco?': 'Supprimer cette reco ?',
    'This cannot be undone. If it is the last reco for the restaurant, the restaurant disappears from the map.': 'C’est définitif. Si c’est la dernière reco de ce restaurant, il disparaît de la carte.',
    'Searching…': 'Recherche…',
    'No places found. Try another spelling, or paste a Google Maps link.': 'Aucun lieu trouvé. Essayez une autre orthographe, ou collez un lien Google Maps.',
    'Short links cannot be read. Open the link, then copy the full address from your browser and paste it here.': 'Les liens courts ne peuvent pas être lus. Ouvrez le lien, puis copiez l’adresse complète depuis votre navigateur et collez-la ici.',
    'This link has no location. Search for the restaurant by name instead.': 'Ce lien ne contient pas d’emplacement. Cherchez plutôt le restaurant par son nom.',
    'The place search is not available right now. Try again in a moment.': 'La recherche de lieux n’est pas disponible pour le moment. Réessayez dans un instant.',
    'Your reco is saved.': 'Votre reco est enregistrée.',
    'Your reco is added.': 'Votre reco est ajoutée.',
    'The reco was deleted.': 'La reco a été supprimée.',
    'Please write a reco of 1 to 300 characters.': 'Merci d’écrire une reco de 1 à 300 caractères.',
    'Please enter the restaurant\'s name.': 'Merci de saisir le nom du restaurant.',
    'You do not have permission to do that.': 'Vous n’avez pas le droit de faire cela.',
    'You need a member profile to add a reco.': 'Il faut un profil de membre pour ajouter une reco.',
    'You can only post as a club you belong to.': 'Vous ne pouvez publier qu’au nom d’un club dont vous êtes membre.',
    'Visibility must be everyone, club or me.': 'La visibilité doit être : tout le monde, mon club ou moi seulement.',
    'The location is missing or not valid.': 'L’emplacement manque ou n’est pas valide.',

    // messages the database sends
    'You cannot remove your own email address.': 'Vous ne pouvez pas retirer votre propre adresse e-mail.',
    'The last admin of this club cannot be removed or demoted. Add another admin first.': 'Le dernier admin de ce club ne peut pas être retiré ni rétrogradé. Ajoutez d’abord un autre admin.',
    'This person is also in a club you do not manage. Ask a super admin.': 'Cette personne est aussi dans un club que vous ne gérez pas. Demandez à un super admin.',
    'The new email address does not look right.': 'La nouvelle adresse e-mail ne semble pas correcte.',
    'The new email is the same as the old one.': 'Le nouvel e-mail est identique à l’ancien.',
    'That person is not in this club.': 'Cette personne n’est pas dans ce club.',
    'That email is not on this club\'s list.': 'Cet e-mail ne figure pas sur la liste de ce club.',
    'Only admins of this club can add members.': 'Seuls les admins de ce club peuvent ajouter des membres.',
    'Only admins of this club can remove access.': 'Seuls les admins de ce club peuvent retirer un accès.',
    'Only admins of this club can remove members.': 'Seuls les admins de ce club peuvent retirer des membres.',
    'Only admins of this club can change brigadier groups.': 'Seuls les admins de ce club peuvent modifier les groupes de brigadiers.',
    'That brigadier group no longer exists.': 'Ce groupe de brigadiers n’existe plus.',
    'Everyone in a brigadier group must have a card in this club. Reload and try again.': 'Chaque membre d’un groupe de brigadiers doit avoir une fiche dans ce club. Rechargez la page et réessayez.'
  };

  // ---- Sentences with a name or number inside. Each: [English pattern, French result]. ----
  // In the result, $1, $2... are the pattern's parts; {t1}, {t2}... are those parts translated too.
  var PATTERNS = [
    [/^(\d+) members?$/, function (m) { return m[1] + (m[1] === '1' ? ' membre' : ' membres'); }],
    [/^(\d+) members? match(?:es)?$/, function (m) { return m[1] === '1' ? '1 membre correspond' : m[1] + ' membres correspondent'; }],
    [/^(\d+) of (500|300) characters$/, '$1 sur $2 caractères'],
    [/^(\d+) recos?$/, function (m) { return m[1] + (m[1] === '1' ? ' reco' : ' recos'); }],
    [/^(\d+) restaurants?$/, function (m) { return m[1] + (m[1] === '1' ? ' restaurant' : ' restaurants'); }],
    [/^(\d+) restaurants? match(?:es)?$/, function (m) { return m[1] === '1' ? '1 restaurant correspond' : m[1] + ' restaurants correspondent'; }],
    [/^Could not (load the recos|save your reco|delete the reco|add your reco)\. (.+)$/, function (m, t) {
      var what = { 'load the recos': 'Impossible de charger les recos.', 'save your reco': 'Impossible d’enregistrer votre reco.',
        'delete the reco': 'Impossible de supprimer la reco.', 'add your reco': 'Impossible d’ajouter votre reco.' }[m[1]];
      return what + ' ' + t(m[2]);
    }],
    [/^Co-brigadier:$/, 'Co-brigadier :'],
    [/^Co-brigadiers:$/, 'Co-brigadiers :'],
    [/^Photo of (.+)$/, 'Photo de $1'],
    [/^(.+) map$/, 'Carte $1'],
    [/^Group (\d+)$/, 'Groupe $1'],
    [/^Edit group (\d+)$/, 'Modifier le groupe $1'],
    [/^(.*) \(in group ([\d, ]+)\)$/, '$1 (groupe $2)'],
    [/^(Listed|Hidden), foreign$/, '{t1}, à l’étranger'],
    [/^(\d+) emails? \((\d+) admins?\)$/, function (m) { return m[1] + (m[1] === '1' ? ' e-mail' : ' e-mails') + ' (' + m[2] + ' admin' + (m[2] === '1' ? '' : 's') + ')'; }],
    [/^(\d+) cards?(?: \((.+)\))?$/, function (m) {
      var notes = (m[2] || '').replace(/(\d+) hidden/, '$1 masquée(s)').replace(/(\d+) without access/, '$1 sans accès');
      return m[1] + (m[1] === '1' ? ' fiche' : ' fiches') + (notes ? ' (' + notes + ')' : '');
    }],
    // aria-labels
    [/^Remove access for (.+)$/, 'Retirer l’accès de $1'],
    [/^Change email (.+)$/, 'Changer l’e-mail de $1'],
    [/^Create a card for (.+)$/, 'Créer une fiche pour $1'],
    [/^No card needed for (.+)$/, 'Pas de fiche pour $1'],
    [/^Edit the card of (.+)$/, 'Modifier la fiche de $1'],
    [/^Hide (.+) from the directory$/, 'Masquer $1 dans l’annuaire'],
    [/^Show (.+) in the directory$/, 'Afficher $1 dans l’annuaire'],
    [/^Remove (.+) from the club$/, 'Retirer $1 du club'],
    [/^Edit group (\d+): (.+)$/, 'Modifier le groupe $1 : $2'],
    [/^Delete group (\d+): (.+)$/, 'Supprimer le groupe $1 : $2'],
    // page titles
    [/^Directory: (.+)$/, 'Annuaire : $1'],
    [/^Admin: (.+)$/, 'Admin : $1'],
    [/^Edit profile: (.+)$/, 'Modifier le profil : $1'],
    [/^Edit profile$/, 'Modifier le profil'],
    [/^Members$/, 'Membres'],
    [/^Profile$/, 'Profil'],
    // login messages
    [/^Check your email \((.+)\) and open the link to confirm your account\. If you already have an account, sign in instead\.$/, 'Consultez votre boîte mail ($1) et ouvrez le lien pour confirmer votre compte. Si vous avez déjà un compte, connectez-vous plutôt.'],
    [/^If (.+) has an account, we have emailed a link to choose a new password\.$/, 'Si $1 a un compte, nous avons envoyé un lien pour choisir un nouveau mot de passe.'],
    [/^We have sent a sign-in link to (.+)\. Open it on this device or any other\.$/, 'Nous avons envoyé un lien de connexion à $1. Ouvrez-le sur cet appareil ou un autre.'],
    // profile messages
    [/^Your card in (.+?)\. (.+)$/, 'Votre fiche dans $1. {t2}'],
    [/^Member added: (.+?)\. Add a bio, phone or photo below, or leave it as it is\.$/, 'Membre ajouté : $1. Ajoutez une bio, un téléphone ou une photo ci-dessous, ou laissez tel quel.'],
    [/^(.+) has not signed in yet\. When they sign in with that email, they can edit this profile themselves\.$/, '$1 ne s’est pas encore connecté. En se connectant avec cet e-mail, cette personne pourra modifier ce profil elle-même.'],
    [/^(.+) is not on the member list: they cannot sign in to the site\. If their card is listed, it is marked "Former member"\.$/, '$1 ne figure pas sur la liste des membres : cette personne ne peut pas se connecter. Si sa fiche est visible, elle porte la mention « Ancien membre ».'],
    [/^You are editing this profile as an admin\. Changes show in the directory straight away\. (.+)$/, 'Vous modifiez ce profil en tant qu’admin. Les changements apparaissent tout de suite dans l’annuaire. {t1}'],
    [/^Could not save\. (.+)$/, 'Enregistrement impossible. {t1}'],
    // admin messages
    [/^(.+) can no longer sign in\.(.*)$/, function (m, t) {
      var tail = m[2].trim();
      tail = tail === 'Their card is hidden.' ? ' Sa fiche est masquée.' : (tail === 'Their card is still listed, marked "Former member".' ? ' Sa fiche reste visible, avec la mention « Ancien membre ».' : (tail ? ' ' + t(tail) : ''));
      return m[1] + ' ne peut plus se connecter.' + tail;
    }],
    [/^Access restored for (.+?)\. Their existing card was kept and is (listed|hidden)\.$/, function (m) { return 'Accès rétabli pour ' + m[1] + '. Sa fiche existante est conservée et ' + (m[2] === 'listed' ? 'visible.' : 'masquée.'); }],
    [/^(.+) now has access as (an admin|a member), with no directory card\.(.*)$/, function (m) {
      return m[1] + ' a maintenant accès en tant que ' + (m[2] === 'an admin' ? 'admin' : 'membre') + ', sans fiche dans l’annuaire.' +
        (m[3].trim() ? ' Sa fiche existante est conservée ; supprimez-la ci-dessous si elle n’est pas souhaitée.' : '');
    }],
    [/^(.+) is now listed in the directory\.$/, '$1 est maintenant visible dans l’annuaire.'],
    [/^(.+) is now hidden from the directory\.$/, '$1 est maintenant masqué dans l’annuaire.'],
    [/^(.+) was removed from (.+?)\.(?: Brigadier group ([\d, ]+) was deleted\.)?$/, function (m) { return m[1] + ' a été retiré du club ' + m[2] + '.' + (m[3] ? ' Le groupe de brigadiers ' + m[3] + ' a été supprimé.' : ''); }],
    [/^Brigadier group ([\d, ]+) would be left with fewer than two members, so (?:it|they) will be deleted too\.$/, 'Le groupe de brigadiers $1 n’aurait plus que un membre : il sera supprimé aussi.'],
    [/^(.+) is now (.+?)\. Ask them to sign in with the new email; their card links to them automatically\.$/, '$1 devient $2. Demandez à la personne de se connecter avec le nouvel e-mail ; sa fiche lui sera reliée automatiquement.'],
    [/^Group (\d+) (created|saved): (.+)\.$/, function (m) { return 'Groupe ' + m[1] + (m[2] === 'created' ? ' créé : ' : ' enregistré : ') + m[3] + '.'; }],
    [/^Group (\d+) was deleted\.$/, 'Le groupe $1 a été supprimé.'],
    [/^(.+) will get a card when they next sign in\.$/, '$1 aura une fiche à sa prochaine connexion.'],
    [/^(.+) is marked as an office\/staff account: no card will be created for it\.$/, '$1 est un compte du bureau ou du personnel : aucune fiche ne sera créée.'],
    [/^Type a display name for (.+) and press "Add member" to create their card\.$/, 'Saisissez un nom affiché pour $1 et cliquez sur « Ajouter » pour créer sa fiche.'],
    [/^(.+) already has access and a card\. Use "Edit" in the cards list to change it\.$/, '$1 a déjà un accès et une fiche. Utilisez « Modifier » dans la liste des fiches.'],
    [/^(.+) already has access\. Use "No card" in the Access table instead\.$/, '$1 a déjà un accès. Utilisez plutôt « Pas de fiche » dans le tableau Accès.'],
    [/^Removing this person would leave brigadier group\(s\) ([\d, ]+) with fewer than two members\. Confirm to delete those groups\.$/, 'Retirer cette personne laisserait le(s) groupe(s) de brigadiers $1 avec moins de deux membres. Confirmez pour supprimer ces groupes.'],
    [/^Could not (add|change|check|remove|update) (.+?)\. (.+)$/, function (m, t) {
      var verb = { add: 'd’ajouter', change: 'de modifier', check: 'de vérifier', remove: 'de retirer', update: 'de mettre à jour' }[m[1]];
      return 'Impossible ' + verb + ' ' + m[2] + '. ' + t(m[3]);
    }],
    [/^Could not load members\. (.+)$/, 'Impossible de charger les membres. {t1}'],
    [/^Could not load the directory\. (.+)$/, 'Impossible de charger l’annuaire. {t1}'],
    [/^Could not save the group\. (.+)$/, 'Impossible d’enregistrer le groupe. {t1}'],
    [/^Could not delete the group\. (.+)$/, 'Impossible de supprimer le groupe. {t1}']
  ];

  function norm(text) { return String(text).replace(/\s+/g, ' ').trim(); }

  // Returns the French for an English text, or null when unknown.
  function translate(text) {
    if (lang !== 'fr') return null;
    var key = norm(text);
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(FR, key)) return FR[key];
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = key.match(PATTERNS[i][0]);
      if (!m) continue;
      var out = PATTERNS[i][1];
      if (typeof out === 'function') return out(m, function (s) { return translate(s) || s; });
      return out.replace(/\{t(\d)\}/g, function (_, n) { return translate(m[Number(n)]) || m[Number(n)]; })
                .replace(/\$(\d)/g, function (_, n) { return m[Number(n)] || ''; });
    }
    return null;
  }

  // A translated text keeps the spaces around the original (text sits next to names and links).
  function swap(original, french) {
    var lead = original.match(/^\s*/)[0], trail = original.match(/\s*$/)[0];
    return lead + french + trail;
  }

  function skip(node) {
    var elm = node.nodeType === 1 ? node : node.parentElement;
    return !elm || !!elm.closest('script, style, noscript, textarea, [data-no-i18n]');
  }

  var ATTRS = ['aria-label', 'title', 'alt', 'placeholder'];

  function translateTextNode(node) {
    if (skip(node)) return;
    var fr = translate(node.nodeValue);
    if (fr !== null && fr !== norm(node.nodeValue)) node.nodeValue = swap(node.nodeValue, fr);
  }

  function translateElement(elm) {
    if (skip(elm)) return;
    ATTRS.forEach(function (a) {
      if (!elm.hasAttribute(a)) return;
      var fr = translate(elm.getAttribute(a));
      if (fr !== null && fr !== elm.getAttribute(a)) elm.setAttribute(a, fr);
    });
  }

  function translateTree(root) {
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1) return;
    translateElement(root);
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) translateTextNode(node); else translateElement(node);
    }
  }

  // "Something · The Nines" -> "<French something> · <this club's name>"
  function translateTitle() {
    var parts = document.title.split(' · ');
    var last = parts.length - 1;
    var fixed = parts.map(function (part, i) {
      if (i === last && part === 'The Nines') return club.NAME;
      return translate(part) || part;
    }).join(' · ');
    if (fixed !== document.title) document.title = fixed;
  }

  // ---- Club branding on the static pages ----
  function fillClubText() {
    document.querySelectorAll('[data-club-name]').forEach(function (n) { n.textContent = club.NAME; });
    document.querySelectorAll('[data-club-tagline]').forEach(function (n) { if (club.TAGLINE) n.textContent = club.TAGLINE; });
    document.querySelectorAll('[data-club-footer]').forEach(function (n) { if (club.FOOTER) n.textContent = club.FOOTER; });
    document.querySelectorAll('[data-club-map]').forEach(function (n) { if (club.MAP_URL) n.setAttribute('href', club.MAP_URL); });
  }

  fillClubText();
  translateTitle();
  if (lang === 'fr') {
    translateTree(document.body);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mu) {
        if (mu.type === 'characterData') translateTextNode(mu.target);
        else if (mu.type === 'attributes') translateElement(mu.target);
        else mu.addedNodes.forEach(translateTree);
      });
      translateTitle();
    }).observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS
    });
  }

  window.NinesI18n = { lang: lang, translate: function (s) { return translate(s) || s; } };
})();
